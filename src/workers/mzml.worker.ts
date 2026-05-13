/// <reference lib="webworker" />
// Browser mzML / mzXML parser. Extracts MS1 retention times, TIC, BPC,
// per-scan centroided (m/z, intensity) arrays, picks peaks on the TIC and
// assigns each peak an apex m/z + ±10 ppm window. Returns a compressed
// scans blob suitable for storage and later EIC extraction.
//
// Posts back: { ok: true, summary, scansBlob } or { ok: false, error }

import { XMLParser } from "fast-xml-parser";
import { inflate, deflate } from "pako";

export type WorkerPeak = {
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
  mz: number | null;
  mzLow: number | null;
  mzHigh: number | null;
};

export type WorkerRunSummary = {
  trace: { x: number[]; tic: number[]; bpc: number[] };
  peaks: WorkerPeak[];
  ionMode: "positive" | "negative";
  format: "mzML" | "mzXML";
  msLevel: 1;
  scanCount: number;
  truncated: boolean;
};

// ---------- helpers ----------

function b64ToFloat(
  b64: string,
  precision: 32 | 64,
  compressed: boolean,
  littleEndian = true,
): Float32Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const bytes = compressed ? inflate(buf) : buf;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = precision === 64 ? bytes.byteLength >>> 3 : bytes.byteLength >>> 2;
  const out = new Float32Array(n);
  if (precision === 64) {
    for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, littleEndian);
  } else {
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, littleEndian);
  }
  return out;
}

function pickArrays(arr: any[]): {
  mz: { precision: 32 | 64; compressed: boolean; raw: string } | null;
  intensity: { precision: 32 | 64; compressed: boolean; raw: string } | null;
} {
  let mz: any = null,
    intensity: any = null;
  for (const a of arr) {
    const cv = Array.isArray(a.cvParam) ? a.cvParam : [a.cvParam].filter(Boolean);
    const accs = cv.map((c: any) => c?.["@_accession"] ?? "");
    const isMz = accs.includes("MS:1000514");
    const isInt = accs.includes("MS:1000515");
    const precision: 32 | 64 = accs.includes("MS:1000523") ? 64 : 32;
    const compressed = accs.includes("MS:1000574");
    const bin = a?.binary;
    if (typeof bin !== "string") continue;
    const slot = { precision, compressed, raw: bin };
    if (isMz) mz = slot;
    if (isInt) intensity = slot;
  }
  return { mz, intensity };
}

function getRetentionTime(scan: any): number {
  const sl = scan?.scanList?.scan;
  const sList = Array.isArray(sl) ? sl : [sl].filter(Boolean);
  for (const s of sList) {
    const cv = Array.isArray(s?.cvParam) ? s.cvParam : [s?.cvParam].filter(Boolean);
    for (const c of cv) {
      if (c?.["@_accession"] === "MS:1000016") {
        const v = parseFloat(c["@_value"]);
        const unit = c["@_unitName"] ?? c["@_unitAccession"] ?? "";
        return /second|MS:1000038/i.test(unit) ? v / 60 : v;
      }
    }
  }
  return 0;
}

function detectIonMode(spec: any): "positive" | "negative" | null {
  const cv = Array.isArray(spec?.cvParam) ? spec.cvParam : [spec?.cvParam].filter(Boolean);
  for (const c of cv) {
    if (c?.["@_accession"] === "MS:1000130") return "positive";
    if (c?.["@_accession"] === "MS:1000129") return "negative";
  }
  return null;
}

// Centroid + threshold a profile-mode scan: keep local maxima above
// baseline + 5*MAD. For already-centroided data this is a no-op-ish filter.
function centroidAndThreshold(mz: Float32Array, intens: Float32Array): {
  mz: Float32Array;
  intens: Float32Array;
} {
  if (mz.length === 0) return { mz: new Float32Array(0), intens: new Float32Array(0) };
  // Fast baseline from quantile
  const sorted = Float32Array.from(intens).sort();
  const baseline = sorted[Math.floor(sorted.length * 0.5)] || 0;
  // MAD
  let madSum = 0;
  for (let i = 0; i < intens.length; i++) madSum += Math.abs(intens[i] - baseline);
  const mad = madSum / intens.length;
  const thr = baseline + 5 * mad;

  const outMz: number[] = [];
  const outIn: number[] = [];
  for (let i = 1; i < intens.length - 1; i++) {
    const v = intens[i];
    if (v <= thr) continue;
    if (v >= intens[i - 1] && v >= intens[i + 1]) {
      outMz.push(mz[i]);
      outIn.push(v);
    }
  }
  // Hard cap to avoid unbounded blob growth
  if (outMz.length > 2000) {
    const idx = outIn
      .map((v, i) => [v, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2000)
      .map(([, i]) => i)
      .sort((a, b) => a - b);
    return {
      mz: Float32Array.from(idx.map((i) => outMz[i])),
      intens: Float32Array.from(idx.map((i) => outIn[i])),
    };
  }
  return { mz: Float32Array.from(outMz), intens: Float32Array.from(outIn) };
}

function pickPeaks(
  x: number[],
  y: number[],
  topN = 60,
): Array<{ idx: number; rt: number; area: number; height: number; fwhm: number; sn: number }> {
  if (x.length < 5) return [];
  const sorted = [...y].sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const lows = y.filter((v) => v <= baseline * 1.5);
  const mean = lows.reduce((s, v) => s + v, 0) / Math.max(1, lows.length);
  const sd = Math.sqrt(lows.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, lows.length));
  const noise = Math.max(1, sd);

  const candidates: Array<{ i: number; h: number }> = [];
  for (let i = 2; i < y.length - 2; i++) {
    if (
      y[i] > y[i - 1] &&
      y[i] > y[i + 1] &&
      y[i] > y[i - 2] &&
      y[i] > y[i + 2] &&
      y[i] > baseline + 5 * noise
    ) {
      candidates.push({ i, h: y[i] });
    }
  }
  const top = candidates.sort((a, b) => b.h - a.h).slice(0, topN);
  return top
    .map(({ i, h }) => {
      const half = h / 2;
      let l = i;
      while (l > 0 && y[l] > half) l--;
      let r = i;
      while (r < y.length - 1 && y[r] > half) r++;
      const fwhm = Math.max(0.001, x[r] - x[l]);
      let area = 0;
      for (let k = l; k < r; k++) area += ((y[k] + y[k + 1]) / 2) * (x[k + 1] - x[k]);
      return {
        idx: i,
        rt: +x[i].toFixed(4),
        area: +area.toFixed(0),
        height: +h.toFixed(0),
        fwhm: +fwhm.toFixed(4),
        sn: +(h / noise).toFixed(1),
      };
    })
    .sort((a, b) => a.rt - b.rt);
}

// ---------- scans blob format (little-endian) ----------
//   u32 magic = 0x53434E31  ("SCN1")
//   u32 numScans
//   per scan:
//     f32 rt
//     u32 n
//     f32[n] mz
//     f32[n] intensity
// (All concatenated, then pako.deflate)

function packScans(
  scans: Array<{ rt: number; mz: Float32Array; intens: Float32Array }>,
): Uint8Array {
  let total = 8;
  for (const s of scans) total += 4 + 4 + s.mz.byteLength + s.intens.byteLength;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, 0x53434e31, true);
  o += 4;
  dv.setUint32(o, scans.length, true);
  o += 4;
  for (const s of scans) {
    dv.setFloat32(o, s.rt, true);
    o += 4;
    dv.setUint32(o, s.mz.length, true);
    o += 4;
    new Float32Array(buf, o, s.mz.length).set(s.mz);
    o += s.mz.byteLength;
    new Float32Array(buf, o, s.intens.length).set(s.intens);
    o += s.intens.byteLength;
  }
  return deflate(new Uint8Array(buf));
}

// ---------- mzML/mzXML parse ----------

async function parseMzML(text: string): Promise<{ summary: WorkerRunSummary; scansBlob: Uint8Array }> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(text);
  const isMzXml = !!doc?.mzXML;
  const root = doc?.indexedmzML?.mzML ?? doc?.mzML ?? doc?.mzXML;

  const x: number[] = [];
  const tic: number[] = [];
  const bpc: number[] = [];
  const scans: Array<{ rt: number; mz: Float32Array; intens: Float32Array }> = [];

  let ionMode: "positive" | "negative" = "positive";
  let ionDetected = false;
  let truncated = false;
  let pointBudget = 5_000_000;

  // Normalize to a list of MS1 spectrum-like records with rt + mz/intensity arrays.
  const specs: any[] = isMzXml
    ? (() => {
        // mzXML: <scan> elements possibly nested; collect MS1 only.
        const acc: any[] = [];
        const walk = (s: any) => {
          if (!s) return;
          const arr = Array.isArray(s) ? s : [s];
          for (const sc of arr) {
            const lvl = parseInt(sc?.["@_msLevel"] ?? "1", 10);
            if (lvl === 1) acc.push(sc);
            if (sc?.scan) walk(sc.scan);
          }
        };
        walk(root?.msRun?.scan);
        return acc;
      })()
    : (() => {
        const sl = root?.run?.spectrumList?.spectrum;
        return Array.isArray(sl) ? sl : sl ? [sl] : [];
      })();

  for (const s of specs) {
    let rt = 0;
    let mzArr: Float32Array = new Float32Array(0);
    let intArr: Float32Array = new Float32Array(0);
    let ticVal = 0;
    let bpcVal = 0;

    if (isMzXml) {
      const t = s?.["@_retentionTime"] ?? "";
      const m = String(t).match(/PT?([0-9.]+)S?/i);
      rt = m ? parseFloat(m[1]) / 60 : 0;
      const polarity = s?.["@_polarity"];
      if (!ionDetected && polarity) {
        ionMode = polarity === "-" ? "negative" : "positive";
        ionDetected = true;
      }
      const peaks = s?.peaks;
      const peaksList = Array.isArray(peaks) ? peaks : peaks ? [peaks] : [];
      const readNode = (node: any) => {
        const raw = typeof node === "string" ? node : (node?.["#text"] ?? "");
        const precision: 32 | 64 = (parseInt(node?.["@_precision"] ?? "32", 10) === 64 ? 64 : 32) as 32 | 64;
        const compressed = (node?.["@_compressionType"] ?? "none") !== "none";
        // mzXML defaults to network byte order (BIG-endian). Only "little" means LE.
        const byteOrder = String(node?.["@_byteOrder"] ?? "network").toLowerCase();
        const littleEndian = byteOrder === "little";
        return raw ? b64ToFloat(raw, precision, compressed, littleEndian) : new Float32Array(0);
      };

      // Two layouts exist:
      //   A) one <peaks> with interleaved m/z-int pairs (default)
      //   B) two <peaks> with contentType="m/z" and contentType="intensity"
      const splitMz = peaksList.find((n: any) => /m\/?z/i.test(n?.["@_contentType"] ?? ""));
      const splitInt = peaksList.find((n: any) => /intensity/i.test(n?.["@_contentType"] ?? ""));
      if (splitMz && splitInt) {
        mzArr = readNode(splitMz);
        intArr = readNode(splitInt);
      } else if (peaksList.length > 0) {
        const flat = readNode(peaksList[0]);
        const half = flat.length >>> 1;
        mzArr = new Float32Array(half);
        intArr = new Float32Array(half);
        for (let i = 0; i < half; i++) {
          mzArr[i] = flat[i * 2];
          intArr[i] = flat[i * 2 + 1];
        }
      }
    } else {
      const cv = Array.isArray(s?.cvParam) ? s.cvParam : [s?.cvParam].filter(Boolean);
      const msLevel = cv.find((c: any) => c?.["@_accession"] === "MS:1000511");
      if (msLevel && parseInt(msLevel["@_value"], 10) !== 1) continue;
      if (!ionDetected) {
        const m = detectIonMode(s);
        if (m) {
          ionMode = m;
          ionDetected = true;
        }
      }
      rt = getRetentionTime(s);
      const ticCv = cv.find((c: any) => c?.["@_accession"] === "MS:1000285");
      const bpcCv = cv.find((c: any) => c?.["@_accession"] === "MS:1000505");
      if (ticCv) ticVal = parseFloat(ticCv["@_value"]);
      if (bpcCv) bpcVal = parseFloat(bpcCv["@_value"]);

      const bdl = s?.binaryDataArrayList?.binaryDataArray;
      const arrs = Array.isArray(bdl) ? bdl : bdl ? [bdl] : [];
      const { mz, intensity } = pickArrays(arrs);
      if (mz && intensity) {
        mzArr = b64ToFloat(mz.raw, mz.precision, mz.compressed);
        intArr = b64ToFloat(intensity.raw, intensity.precision, intensity.compressed);
      }
    }

    if (!ticVal && intArr.length > 0) {
      let s2 = 0;
      for (let i = 0; i < intArr.length; i++) s2 += intArr[i];
      ticVal = s2;
    }
    if (!bpcVal && intArr.length > 0) {
      let mx = 0;
      for (let i = 0; i < intArr.length; i++) if (intArr[i] > mx) mx = intArr[i];
      bpcVal = mx;
    }

    let kept = { mz: mzArr, intens: intArr };
    if (mzArr.length > 0) kept = centroidAndThreshold(mzArr, intArr);

    // Budget guard
    if (pointBudget - kept.mz.length < 0) {
      truncated = true;
    } else {
      pointBudget -= kept.mz.length;
      scans.push({ rt: +rt.toFixed(4), mz: kept.mz, intens: kept.intens });
    }

    x.push(+rt.toFixed(4));
    tic.push(ticVal);
    bpc.push(bpcVal);
  }

  // Pick peaks on TIC, then for each peak find apex m/z = strongest m/z
  // in the centroided scan at that retention time.
  const pickedRaw = pickPeaks(x, tic);
  const peaks: WorkerPeak[] = pickedRaw.map((p) => {
    const sIdx = Math.min(scans.length - 1, Math.max(0, p.idx));
    const sc = scans[sIdx];
    let mz: number | null = null;
    if (sc && sc.mz.length > 0) {
      let best = 0;
      let bestI = 0;
      for (let i = 0; i < sc.intens.length; i++) {
        if (sc.intens[i] > best) {
          best = sc.intens[i];
          bestI = i;
        }
      }
      mz = +sc.mz[bestI].toFixed(4);
    }
    const window = mz != null ? mz * 10e-6 : 0;
    return {
      rt: p.rt,
      area: p.area,
      height: p.height,
      fwhm: p.fwhm,
      sn: p.sn,
      mz,
      mzLow: mz != null ? +(mz - window).toFixed(4) : null,
      mzHigh: mz != null ? +(mz + window).toFixed(4) : null,
    };
  });

  const summary: WorkerRunSummary = {
    trace: { x, tic, bpc },
    peaks,
    ionMode,
    format: isMzXml ? "mzXML" : "mzML",
    msLevel: 1,
    scanCount: scans.length,
    truncated,
  };
  const scansBlob = packScans(scans);
  return { summary, scansBlob };
}

self.onmessage = async (e: MessageEvent) => {
  const { id, text } = e.data as { id: string; text: string };
  try {
    const { summary, scansBlob } = await parseMzML(text);
    (self as unknown as Worker).postMessage(
      { id, ok: true, summary, scansBlob },
      [scansBlob.buffer],
    );
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
};
