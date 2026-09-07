// Node.js worker thread for parsing mzXML/mzML files.
// This is a port of the browser mzml.worker.ts — same parsing logic but
// reads from the filesystem instead of receiving text via postMessage.
//
// The worker receives a file path via workerData, reads the file,
// parses it, and posts the result back.
import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { inflate, deflate } from "pako";

// ---------- Types (same as browser worker) ----------
type WorkerPeak = {
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
  mz: number | null;
  mzLow: number | null;
  mzHigh: number | null;
  r2?: number;
  asymmetry?: number;
};

type WorkerRunSummary = {
  trace: { x: number[]; tic: number[]; bpc: number[] };
  peaks: WorkerPeak[];
  ionMode: "positive" | "negative";
  format: "mzML" | "mzXML";
  msLevel: 1;
  scanCount: number;
  truncated: boolean;
  ms2Count: number;
};

// ---------- decode helpers ----------
function b64ToFloat(
  b64: string,
  precision: 32 | 64,
  compressed: boolean,
  littleEndian = true,
): Float32Array {
  const bin = Buffer.from(b64, "base64");
  const bytes = compressed ? inflate(bin) : new Uint8Array(bin);
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
  let mz: any = null, intensity: any = null;
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

function centroidAndThreshold(mz: any, intens: any): {
  mz: any; intens: any;
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
      if (v > noise) { outMz.push(mz[i]); outIn.push(v); }
    }
  } else {
    for (let i = 1; i < n - 1; i++) {
      if (intens[i] > noise && intens[i] >= intens[i - 1] && intens[i] >= intens[i + 1]) {
        outMz.push(mz[i]); outIn.push(intens[i]);
      }
    }
  }
  return { mz: new Float32Array(outMz), intens: new Float32Array(outIn) };
}

// ---------- Mass trace building + peak picking ----------
type Scan = { rt: number; mz: any; intens: any };
type Trace = { mz: number; scanIdx: number[]; intens: number[] };

function buildMassTraces(scans: Scan[], ppm: number, maxGap: number): Trace[] {
  const traces: Trace[] = [];
  for (let si = 0; si < scans.length; si++) {
    const s = scans[si];
    for (let pi = 0; pi < s.mz.length; pi++) {
      const m = s.mz[pi];
      const v = s.intens[pi];
      let placed = false;
      for (const t of traces) {
        const tol = (t.mz * ppm) / 1e6;
        if (Math.abs(t.mz - m) <= tol) {
          const lastIdx = t.scanIdx[t.scanIdx.length - 1];
          if (si - lastIdx <= maxGap) {
            t.scanIdx.push(si);
            t.intens.push(v);
            // Update running average m/z
            t.mz = (t.mz * (t.scanIdx.length - 1) + m) / t.scanIdx.length;
            placed = true;
            break;
          }
        }
      }
      if (!placed && v > 0) {
        traces.push({ mz: m, scanIdx: [si], intens: [v] });
      }
    }
  }
  return traces;
}

type TracePeak = {
  rt: number; area: number; height: number; fwhm: number; sn: number;
  mz: number; mzLow: number; mzHigh: number; r2: number; asymmetry: number;
};

function savitzkyGolay(y: number[]): number[] {
  if (y.length < 5) return y.slice();
  const out = new Array(y.length).fill(0);
  const coeffs = [-3, 12, 17, 12, -3];
  for (let i = 2; i < y.length - 2; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += coeffs[j + 2] * y[i + j];
    out[i] = s / 35;
  }
  out[0] = y[0]; out[1] = y[1];
  out[y.length - 1] = y[y.length - 1]; out[y.length - 2] = y[y.length - 2];
  return out;
}

function pickTracePeaks(t: Trace, scanRts: number[], totalScans: number, ppm: number): TracePeak[] {
  const y = t.intens;
  if (y.length < 5) return [];
  const smoothed = savitzkyGolay(y);
  const peaks: TracePeak[] = [];
  const noise = Math.max(...y) / 100;
  for (let i = 2; i < smoothed.length - 2; i++) {
    if (smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1] && smoothed[i] > noise * 3) {
      const height = y[i];
      const rt = scanRts[t.scanIdx[i]];
      // Estimate FWHM
      let halfLeft = i, halfRight = i;
      while (halfLeft > 0 && y[halfLeft] > height / 2) halfLeft--;
      while (halfRight < y.length - 1 && y[halfRight] > height / 2) halfRight++;
      const fwhm = scanRts[t.scanIdx[Math.min(halfRight, scanRts.length - 1)]] - scanRts[t.scanIdx[Math.max(halfLeft, 0)]];
      // Area via trapezoidal integration
      let area = 0;
      for (let j = 0; j < y.length - 1; j++) {
        const dt = scanRts[t.scanIdx[j + 1]] - scanRts[t.scanIdx[j]];
        area += (y[j] + y[j + 1]) / 2 * Math.abs(dt);
      }
      const sn = height / Math.max(noise, 1e-9);
      // R² from Gaussian fit
      const sigma = fwhm / 2.355;
      let ssRes = 0, ssTot = 0;
      const yMean = y.reduce((a, b) => a + b, 0) / y.length;
      for (let j = 0; j < y.length; j++) {
        const predicted = height * Math.exp(-((scanRts[t.scanIdx[j]] - rt) ** 2) / (2 * sigma * sigma));
        ssRes += (y[j] - predicted) ** 2;
        ssTot += (y[j] - yMean) ** 2;
      }
      const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
      // Asymmetry at 10% height
      let tenLeft = i, tenRight = i;
      while (tenLeft > 0 && y[tenLeft] > height * 0.1) tenLeft--;
      while (tenRight < y.length - 1 && y[tenRight] > height * 0.1) tenRight++;
      const asymmetry = (scanRts[t.scanIdx[Math.min(tenRight, scanRts.length - 1)]] - rt) / Math.max(rt - scanRts[t.scanIdx[Math.max(tenLeft, 0)]], 1e-9);
      peaks.push({
        rt, area, height, fwhm: Math.abs(fwhm), sn, mz: t.mz,
        mzLow: t.mz * (1 - ppm / 1e6), mzHigh: t.mz * (1 + ppm / 1e6),
        r2, asymmetry,
      });
    }
  }
  return peaks;
}

// ---------- Scan packing ----------
function packScans(scans: Scan[]): Uint8Array {
  const headers: number[] = [];
  const data: number[] = [];
  let offset = 0;
  for (const s of scans) {
    const n = s.mz.length;
    headers.push(s.rt, n, offset);
    for (let i = 0; i < n; i++) { data.push(s.mz[i], s.intens[i]); }
    offset += n * 2;
  }
  const all = [...headers, ...data];
  const buf = new Float32Array(all);
  const bytes = new Uint8Array(buf.buffer);
  return deflate(bytes);
}

function packMS2Scans(scans: any[]): Uint8Array {
  if (scans.length === 0) return new Uint8Array(0);
  const all: number[] = [];
  for (const s of scans) {
    all.push(s.rt, s.precursorMz, s.precursorIntensity, s.peaks.length);
    for (const p of s.peaks) all.push(p.mz, p.intensity);
  }
  const buf = new Float32Array(all);
  return deflate(new Uint8Array(buf.buffer));
}

// ---------- Main parser ----------
async function parseMzML(text: string): Promise<{
  summary: WorkerRunSummary;
  scansBlob: Uint8Array;
  ms2Blob: Uint8Array;
}> {
  const isMzXml = text.includes("<mzXML") || text.includes("<msRun");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name: string) => name === "spectrum" || name === "scan" || name === "cvParam" || name === "binaryDataArray" || name === "precursorMz" || name === "peaks",
  });
  const doc = parser.parse(text);

  let ionMode: "positive" | "negative" = "positive";
  const scans: Scan[] = [];
  const ms2Scans: any[] = [];
  const x: number[] = [], tic: number[] = [], bpc: number[] = [];
  let truncated = false;
  let pointBudget = 800_000;

  // Extract spectra (mzML or mzXML)
  let spectra: any[] = [];
  if (isMzXml) {
    const run = doc.mzXML?.msRun;
    spectra = (Array.isArray(run?.scan) ? run.scan : run ? [run.scan] : []).filter(Boolean);
  } else {
    const run = doc.mzML?.run;
    const sl = run?.spectrumList;
    spectra = (Array.isArray(sl?.spectrum) ? sl.spectrum : sl?.spectrum ? [sl.spectrum] : []).filter(Boolean);
  }

  for (const spec of spectra) {
    const msLevel = isMzXml
      ? parseInt(spec?.["@_msLevel"] ?? "1")
      : parseInt(
          (Array.isArray(spec?.cvParam) ? spec.cvParam : [spec?.cvParam])
            .find((c: any) => c?.["@_accession"] === "MS:1000511")?.["@_value"] ?? "1",
        );

    const rt = isMzXml
      ? parseFloat(spec?.["@_retentionTime"] ?? "0") / 60
      : getRetentionTime(spec);

    const detected = detectIonMode(spec);
    if (detected) ionMode = detected;

    if (msLevel === 1) {
      let ticVal = 0, bpcVal = 0;
      let mzArr: any = new Float32Array(0), intArr: any = new Float32Array(0);

      if (isMzXml) {
        const peaksNode = spec?.peaks;
        if (peaksNode) {
          const raw = typeof peaksNode === "string" ? peaksNode : peaksNode?.["#text"] ?? peaksNode;
          if (typeof raw === "string") {
            const compressed = (spec?.["@_compressionType"] ?? "") === "zlib";
            const precision = parseInt(spec?.["@_precision"] ?? "32") as 32 | 64;
            const bin = Buffer.from(raw, "base64");
            const bytes = compressed ? inflate(bin) : new Uint8Array(bin);
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const n = bytes.byteLength / (precision / 8) / 2;
            mzArr = new Float32Array(n);
            intArr = new Float32Array(n);
            for (let i = 0; i < n; i++) {
              if (precision === 64) {
                mzArr[i] = dv.getFloat64(i * 16, true);
                intArr[i] = dv.getFloat64(i * 16 + 8, true);
              } else {
                mzArr[i] = dv.getFloat32(i * 8, true);
                intArr[i] = dv.getFloat32(i * 8 + 4, true);
              }
            }
          }
        }
        ticVal = parseFloat(spec?.["@_totIonCurrent"] ?? "0");
        bpcVal = parseFloat(spec?.["@_basePeakIntensity"] ?? "0");
      } else {
        const arrs = Array.isArray(spec?.binaryDataArrayList?.binaryDataArray)
          ? spec.binaryDataArrayList.binaryDataArray
          : spec?.binaryDataArrayList?.binaryDataArray
            ? [spec.binaryDataArrayList.binaryDataArray]
            : [];
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
  }

  // Mass-trace peak detection
  const PPM = 10, MAX_GAP = 3;
  const scanRts = scans.map((s) => s.rt);
  const traces = buildMassTraces(scans, PPM, MAX_GAP);
  const allPeaks: TracePeak[] = [];
  for (const t of traces) {
    if (t.scanIdx.length < 5) continue;
    const peaks = pickTracePeaks(t, scanRts, scans.length, PPM);
    for (const p of peaks) allPeaks.push(p);
  }

  // Merge near-duplicates
  allPeaks.sort((a, b) => (b.r2 - a.r2) || (b.area - a.area));
  const keptPeaks: TracePeak[] = [];
  for (const p of allPeaks) {
    const tol = (p.mz * 5) / 1e6;
    const dup = keptPeaks.find((q) => Math.abs(q.mz - p.mz) <= tol && Math.abs(q.rt - p.rt) <= 0.05);
    if (!dup) keptPeaks.push(p);
    if (keptPeaks.length >= 500) break;
  }
  keptPeaks.sort((a, b) => a.rt - b.rt);

  const peaks: WorkerPeak[] = keptPeaks.map((p) => ({
    rt: p.rt, area: p.area, height: p.height, fwhm: p.fwhm, sn: p.sn,
    mz: p.mz, mzLow: p.mzLow, mzHigh: p.mzHigh, r2: p.r2, asymmetry: p.asymmetry,
  }));

  const summary: WorkerRunSummary = {
    trace: { x, tic, bpc },
    peaks,
    ionMode,
    format: isMzXml ? "mzXML" : "mzML",
    msLevel: 1,
    scanCount: scans.length,
    truncated,
    ms2Count: ms2Scans.length,
  };
  const scansBlob = packScans(scans);
  const ms2Blob = packMS2Scans(ms2Scans);
  return { summary, scansBlob, ms2Blob };
}

// ---------- Worker entry point ----------
const filePath = workerData as string;
try {
  const text = fs.readFileSync(filePath, "utf-8");
  const { summary, scansBlob, ms2Blob } = await parseMzML(text);
  parentPort?.postMessage({ ok: true, summary, scansBlob, ms2Blob }, [scansBlob.buffer as ArrayBuffer, ms2Blob.buffer as ArrayBuffer]);
} catch (err: any) {
  parentPort?.postMessage({ ok: false, error: err?.message ?? String(err) });
}
