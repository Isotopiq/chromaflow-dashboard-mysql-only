/// <reference lib="webworker" />
// Browser mzML / mzXML parser with mass-trace (XIC) peak detection.
//
// Pipeline:
//   1. Parse spectra (mzML or mzXML), keep MS1 only.
//   2. Centroid + threshold (baseline + 3·MAD) each scan.
//   3. Build mass traces across scans (±10 ppm, max 3-scan gap).
//   4. Pick peaks per trace with Savitzky-Golay smoothing + S/N>=3.
//   5. Merge near-duplicate peaks (±5 ppm, <=0.05 min RT).
//   6. Cap at 500 peaks by area.
//
// Returns: { ok: true, summary, scansBlob } or { ok: false, error }.

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
  /** Gaussian-fit R² (0–1). */
  r2?: number;
  /** Asymmetry factor at 10% height (1 = symmetric). */
  asymmetry?: number;
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

// ---------- decode helpers ----------

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

// Centroid + threshold: estimate noise from the lower half of positive
// intensities (robust against a few huge ions dominating MAD). For profile
// data require a local maximum; for already-centroided (sparse) scans every
// centroid above noise is kept.
function centroidAndThreshold(mz: Float32Array, intens: Float32Array): {
  mz: Float32Array;
  intens: Float32Array;
} {
  const n = intens.length;
  if (n === 0) return { mz: new Float32Array(0), intens: new Float32Array(0) };

  let nonZero = 0;
  for (let i = 0; i < n; i++) if (intens[i] > 0) nonZero++;
  const isCentroid = nonZero / n < 0.5;

  const positives: number[] = [];
  for (let i = 0; i < n; i++) if (intens[i] > 0) positives.push(intens[i]);
  positives.sort((a, b) => a - b);
  const lowerHalf = positives.slice(0, Math.max(1, Math.floor(positives.length / 2)));
  const med = lowerHalf[Math.floor(lowerHalf.length / 2)] || 0;
  let madSum = 0;
  for (const v of lowerHalf) madSum += Math.abs(v - med);
  const mad = (madSum / Math.max(1, lowerHalf.length)) * 1.4826;
  const noise = Math.max(med + 3 * mad, 1);

  const outMz: number[] = [];
  const outIn: number[] = [];
  if (isCentroid) {
    for (let i = 0; i < n; i++) {
      const v = intens[i];
      if (v > noise) {
        outMz.push(mz[i]);
        outIn.push(v);
      }
    }
  } else {
    for (let i = 1; i < n - 1; i++) {
      const v = intens[i];
      if (v <= noise) continue;
      if (v >= intens[i - 1] && v >= intens[i + 1]) {
        outMz.push(mz[i]);
        outIn.push(v);
      }
    }
  }
  if (outMz.length > 8000) {
    const idx = outIn
      .map((v, i) => [v, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 8000)
      .map(([, i]) => i)
      .sort((a, b) => a - b);
    return {
      mz: Float32Array.from(idx.map((i) => outMz[i])),
      intens: Float32Array.from(idx.map((i) => outIn[i])),
    };
  }
  return { mz: Float32Array.from(outMz), intens: Float32Array.from(outIn) };
}

// ---------- Savitzky-Golay (length 5, cubic) ----------
function sg5(y: number[]): number[] {
  if (y.length < 5) return y.slice();
  const out = new Array(y.length);
  out[0] = y[0];
  out[1] = y[1];
  out[y.length - 1] = y[y.length - 1];
  out[y.length - 2] = y[y.length - 2];
  for (let i = 2; i < y.length - 2; i++) {
    out[i] =
      (-3 * y[i - 2] + 12 * y[i - 1] + 17 * y[i] + 12 * y[i + 1] - 3 * y[i + 2]) / 35;
  }
  return out;
}

// ---------- mass-trace builder ----------
// Build XIC traces by clustering centroids across scans with ±ppm tolerance
// and a max scan-gap. Greedy nearest-neighbor matching per scan.
type MassTrace = {
  // running weighted m/z
  mz: number;
  weight: number; // sum of intensity (for mz averaging)
  // sparse points: scan index -> intensity (and apex mz)
  scanIdx: number[];
  intensity: number[];
  apexMz: number[];
  lastScan: number;
  // peak m/z window
  mzLowSeen: number;
  mzHighSeen: number;
};

function buildMassTraces(
  scans: Array<{ mz: Float32Array; intens: Float32Array }>,
  ppm: number,
  maxGap: number,
): MassTrace[] {
  // Active traces sorted by mz for fast lookup.
  let active: MassTrace[] = [];
  const finished: MassTrace[] = [];

  for (let s = 0; s < scans.length; s++) {
    const sc = scans[s];
    const n = sc.mz.length;
    if (n === 0) continue;

    // Sort centroids by intensity desc so the strongest ions claim traces first.
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => sc.intens[b] - sc.intens[a]);

    const used = new Uint8Array(active.length);
    for (const ci of order) {
      const m = sc.mz[ci];
      const it = sc.intens[ci];
      // Find best matching active trace within ppm.
      let bestK = -1;
      let bestD = Infinity;
      for (let k = 0; k < active.length; k++) {
        if (used[k]) continue;
        const t = active[k];
        const tol = (t.mz * ppm) / 1e6;
        const d = Math.abs(t.mz - m);
        if (d <= tol && d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      if (bestK >= 0) {
        const t = active[bestK];
        // Update running average m/z weighted by intensity.
        const newW = t.weight + it;
        t.mz = (t.mz * t.weight + m * it) / newW;
        t.weight = newW;
        t.scanIdx.push(s);
        t.intensity.push(it);
        t.apexMz.push(m);
        t.lastScan = s;
        if (m < t.mzLowSeen) t.mzLowSeen = m;
        if (m > t.mzHighSeen) t.mzHighSeen = m;
        used[bestK] = 1;
      } else {
        active.push({
          mz: m,
          weight: it,
          scanIdx: [s],
          intensity: [it],
          apexMz: [m],
          lastScan: s,
          mzLowSeen: m,
          mzHighSeen: m,
        });
      }
    }

    // Retire stale traces.
    if (s % 8 === 0) {
      const next: MassTrace[] = [];
      for (const t of active) {
        if (s - t.lastScan > maxGap) finished.push(t);
        else next.push(t);
      }
      active = next;
    }
  }
  for (const t of active) finished.push(t);
  return finished;
}

// ---------- per-trace peak picker ----------
//
// Validation pipeline (CentWave-inspired, Tautenhahn et al. BMC Bioinf. 2008):
//   1. Smooth with SG5 to suppress single-scan spikes.
//   2. Robust baseline + noise from lower-half MAD of *positive* samples.
//   3. Find local maxima above S/N >= snThreshold AND a height floor.
//   4. Walk outward to baseline + 1σ to find peak boundaries.
//   5. Validate shape: FWHM bounds, asymmetry (10% height) in [0.5, 3.0],
//      and Gaussian-fit R² >= minR2. Reject anything that fails.
//   6. Dedupe overlaps by keeping the higher-R² (tie: larger area) peak.
type TracePeak = {
  rt: number;
  rtL: number;
  rtR: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
  r2: number;
  asymmetry: number;
  mz: number;
  mzLow: number;
  mzHigh: number;
};

type PickerConfig = {
  ppm: number;
  snThreshold: number;
  fwhmMin: number;
  fwhmMax: number;
  minR2: number;
};

const DEFAULT_PICKER: PickerConfig = {
  ppm: 10,
  snThreshold: 5,
  fwhmMin: 0.01,
  fwhmMax: 1.5,
  minR2: 0.75,
};

function gaussianFitR2(
  xs: number[],
  ys: number[],
  apexX: number,
  apexY: number,
  fwhm: number,
): number {
  if (apexY <= 0 || fwhm <= 0 || xs.length < 4) return 0;
  // sigma from FWHM (Gaussian relationship): FWHM = 2*sqrt(2*ln 2)*sigma ≈ 2.3548*sigma
  const sigma = fwhm / 2.3548;
  if (!Number.isFinite(sigma) || sigma <= 0) return 0;
  const two_s2 = 2 * sigma * sigma;
  let ssRes = 0;
  let ssTot = 0;
  let mean = 0;
  for (const y of ys) mean += y;
  mean /= ys.length;
  for (let i = 0; i < xs.length; i++) {
    const fit = apexY * Math.exp(-((xs[i] - apexX) ** 2) / two_s2);
    ssRes += (ys[i] - fit) ** 2;
    ssTot += (ys[i] - mean) ** 2;
  }
  if (ssTot === 0) return 0;
  return Math.max(0, 1 - ssRes / ssTot);
}

function asymmetryAt10(
  xs: number[],
  ys: number[],
  apexIdx: number,
  apexY: number,
  baseline: number,
): number {
  // A_s = (right half-width at 10% height) / (left half-width at 10% height)
  const threshold = baseline + (apexY - baseline) * 0.1;
  let l = apexIdx;
  while (l > 0 && ys[l] > threshold) l--;
  let r = apexIdx;
  while (r < ys.length - 1 && ys[r] > threshold) r++;
  const leftW = xs[apexIdx] - xs[l];
  const rightW = xs[r] - xs[apexIdx];
  if (leftW <= 0) return 99;
  return rightW / leftW;
}

function pickTracePeaks(
  trace: MassTrace,
  scanRts: number[],
  numScans: number,
  ppm: number,
  cfg: PickerConfig = DEFAULT_PICKER,
): TracePeak[] {
  const npts = trace.scanIdx.length;
  if (npts < 5) return [];

  // Dense vector of intensity across scans where this trace had hits.
  const first = trace.scanIdx[0];
  const last = trace.scanIdx[npts - 1];
  const len = last - first + 1;
  if (len < 5) return [];
  const y = new Array<number>(len).fill(0);
  const xMz = new Array<number>(len).fill(0);
  for (let i = 0; i < npts; i++) {
    const idx = trace.scanIdx[i] - first;
    y[idx] = trace.intensity[i];
    xMz[idx] = trace.apexMz[i];
  }
  const xRt = new Array<number>(len);
  for (let i = 0; i < len; i++) xRt[i] = scanRts[first + i];

  const ys = sg5(y);

  // Robust baseline + noise from positive samples (zeros = gaps, not noise).
  const positives = ys.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length < 4) return [];
  const lowerN = Math.max(1, Math.floor(positives.length / 2));
  const lower = positives.slice(0, lowerN);
  const baseline = lower[Math.floor(lower.length / 2)] || 0;
  let madSum = 0;
  for (const v of lower) madSum += Math.abs(v - baseline);
  const noise = Math.max(1, (madSum / lower.length) * 1.4826);
  const apexMax = positives[positives.length - 1];
  // Apex must clear noise floor AND a small fraction of the trace's max,
  // so we don't waste cycles on baseline ripples.
  const minHeight = Math.max(baseline + cfg.snThreshold * noise, apexMax * 0.04);

  const candidates: TracePeak[] = [];
  for (let i = 2; i < len - 2; i++) {
    const v = ys[i];
    if (v < minHeight) continue;
    if (v <= ys[i - 1] || v <= ys[i + 1]) continue;
    if (v <= ys[i - 2] || v <= ys[i + 2]) continue;

    // Half-max boundaries for FWHM.
    const half = (v + baseline) / 2;
    let l = i;
    while (l > 0 && ys[l] > half) l--;
    let r = i;
    while (r < len - 1 && ys[r] > half) r++;
    const fwhm = Math.max(0, xRt[r] - xRt[l]);
    if (fwhm < cfg.fwhmMin || fwhm > cfg.fwhmMax) continue;

    // Extend to baseline+1σ for area & shape fit.
    const stopAt = baseline + noise;
    let lb = i;
    while (lb > 0 && ys[lb] > stopAt && ys[lb - 1] <= ys[lb]) lb--;
    let rb = i;
    while (rb < len - 1 && ys[rb] > stopAt && ys[rb + 1] <= ys[rb]) rb++;
    if (rb - lb < 3) continue;

    // Area: trapezoidal of (y - baseline), clamp negatives.
    let area = 0;
    for (let k = lb; k < rb; k++) {
      const v0 = Math.max(0, ys[k] - baseline);
      const v1 = Math.max(0, ys[k + 1] - baseline);
      area += ((v0 + v1) / 2) * (xRt[k + 1] - xRt[k]);
    }
    if (area <= 0) continue;

    // Shape validation: asymmetry + Gaussian fit on baseline-subtracted profile.
    const asym = asymmetryAt10(xRt, ys, i, v, baseline);
    if (asym < 0.4 || asym > 3.5) continue;

    const xsFit: number[] = [];
    const ysFit: number[] = [];
    for (let k = lb; k <= rb; k++) {
      xsFit.push(xRt[k]);
      ysFit.push(Math.max(0, ys[k] - baseline));
    }
    const r2 = gaussianFitR2(xsFit, ysFit, xRt[i], v - baseline, fwhm);
    if (r2 < cfg.minR2) continue;

    const apexMz = xMz[i] || trace.mz;
    const window = (apexMz * ppm) / 1e6;
    candidates.push({
      rt: +xRt[i].toFixed(4),
      rtL: xRt[lb],
      rtR: xRt[rb],
      area: +area.toFixed(0),
      height: +(v - baseline).toFixed(0),
      fwhm: +fwhm.toFixed(4),
      sn: +((v - baseline) / noise).toFixed(1),
      r2: +r2.toFixed(3),
      asymmetry: +asym.toFixed(2),
      mz: +apexMz.toFixed(4),
      mzLow: +(apexMz - window).toFixed(4),
      mzHigh: +(apexMz + window).toFixed(4),
    });
  }
  return candidates;
}

// ---------- scans blob format (little-endian) ----------
//   u32 magic = 0x53434E31  ("SCN1")
//   u32 numScans
//   per scan:
//     f32 rt
//     u32 n
//     f32[n] mz
//     f32[n] intensity

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
  let pointBudget = 12_000_000;

  const specs: any[] = isMzXml
    ? (() => {
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
        const byteOrder = String(node?.["@_byteOrder"] ?? "network").toLowerCase();
        const littleEndian = byteOrder === "little";
        return raw ? b64ToFloat(raw, precision, compressed, littleEndian) : new Float32Array(0);
      };
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

  // ----- Mass-trace peak detection -----
  const PPM = 10;
  const MAX_GAP = 3;
  const scanRts = scans.map((s) => s.rt);
  const traces = buildMassTraces(scans, PPM, MAX_GAP);

  const allPeaks: TracePeak[] = [];
  for (const t of traces) {
    if (t.scanIdx.length < 5) continue;
    const peaks = pickTracePeaks(t, scanRts, scans.length, PPM);
    for (const p of peaks) allPeaks.push(p);
  }

  // Merge near-duplicates: ±5 ppm AND <=0.05 min rt.
  allPeaks.sort((a, b) => b.area - a.area);
  const kept: TracePeak[] = [];
  for (const p of allPeaks) {
    const tol = (p.mz * 5) / 1e6;
    const dup = kept.find(
      (q) => Math.abs(q.mz - p.mz) <= tol && Math.abs(q.rt - p.rt) <= 0.05,
    );
    if (!dup) kept.push(p);
    if (kept.length >= 500) break;
  }

  kept.sort((a, b) => a.rt - b.rt);

  const peaks: WorkerPeak[] = kept.map((p) => ({
    rt: p.rt,
    area: p.area,
    height: p.height,
    fwhm: p.fwhm,
    sn: p.sn,
    mz: p.mz,
    mzLow: p.mzLow,
    mzHigh: p.mzHigh,
  }));

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
