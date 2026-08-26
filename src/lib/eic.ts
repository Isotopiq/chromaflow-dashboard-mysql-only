// Extract Ion Chromatogram (EIC) helpers — both client and server safe.
// Operates on the gzipped scans blob produced by src/workers/mzml.worker.ts.
//
// Format (after pako.inflate):
//   u32 magic = 0x53434E31  ("SCN1")
//   u32 numScans
//   per scan:
//     f32 rt
//     u32 n
//     f32[n] mz
//     f32[n] intensity

import { inflate } from "pako";

export type EICTrace = { x: number[]; y: number[]; mz: number; ppm: number; mzLow: number; mzHigh: number };

export type ParsedScans = Array<{ rt: number; mz: Float32Array; intens: Float32Array }>;

function lowerBound(values: Float32Array, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function unpackScans(gzipped: Uint8Array): ParsedScans {
  const bytes = inflate(gzipped);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = dv.getUint32(o, true);
  o += 4;
  if (magic !== 0x53434e31) throw new Error("Invalid scans blob magic");
  const num = dv.getUint32(o, true);
  o += 4;
  const out: ParsedScans = [];
  for (let i = 0; i < num; i++) {
    const rt = dv.getFloat32(o, true);
    o += 4;
    const n = dv.getUint32(o, true);
    o += 4;
    // Bytes may not be 4-byte-aligned to the original buffer, copy into new typed arrays.
    const mz = new Float32Array(n);
    const ints = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      mz[j] = dv.getFloat32(o + j * 4, true);
    }
    o += n * 4;
    for (let j = 0; j < n; j++) {
      ints[j] = dv.getFloat32(o + j * 4, true);
    }
    o += n * 4;
    out.push({ rt, mz, intens: ints });
  }
  return out;
}

export function extractEIC(scans: ParsedScans, mz: number, ppm = 10): EICTrace {
  const window = (mz * ppm) / 1e6;
  const lo = mz - window;
  const hi = mz + window;
  const x: number[] = new Array(scans.length);
  const y: number[] = new Array(scans.length);
  for (let s = 0; s < scans.length; s++) {
    const sc = scans[s];
    let sum = 0;
    // m/z arrays from centroiding are sorted; jump directly to the extraction window.
    for (let i = lowerBound(sc.mz, lo); i < sc.mz.length; i++) {
      const m = sc.mz[i];
      if (m > hi) break;
      sum += sc.intens[i];
    }
    x[s] = sc.rt;
    y[s] = sum;
  }
  return { x, y, mz, ppm, mzLow: lo, mzHigh: hi };
}

/** Convenience: blob → EIC in one shot. */
export function extractEICFromBlob(gz: Uint8Array, mz: number, ppm = 10): EICTrace {
  return extractEIC(unpackScans(gz), mz, ppm);
}

// ---- MS2 spectra extraction ----
// MS2 blob format (after pako.inflate):
//   u32 magic = 0x53434E32  ("SCN2")
//   u32 numScans
//   per scan:
//     f32 rt
//     f32 precursorMz
//     f32 collisionEnergy
//     u32 n
//     f32[n] mz
//     f32[n] intensity

export type MS2Scan = {
  rt: number;
  precursorMz: number;
  collisionEnergy: number;
  mz: Float32Array;
  intens: Float32Array;
};

export type MS2Spectrum = {
  precursorMz: number;
  collisionEnergy: number;
  rt: number;
  peaks: Array<{ mz: number; intensity: number }>;
};

export function unpackMS2Scans(gz: Uint8Array): MS2Scan[] {
  const bytes = inflate(gz);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = dv.getUint32(o, true);
  o += 4;
  if (magic !== 0x53434e32) return []; // Not an MS2 blob
  const num = dv.getUint32(o, true);
  o += 4;
  const out: MS2Scan[] = [];
  for (let i = 0; i < num; i++) {
    const rt = dv.getFloat32(o, true);
    o += 4;
    const precursorMz = dv.getFloat32(o, true);
    o += 4;
    const ce = dv.getFloat32(o, true);
    o += 4;
    const n = dv.getUint32(o, true);
    o += 4;
    const mz = new Float32Array(n);
    const ints = new Float32Array(n);
    for (let j = 0; j < n; j++) mz[j] = dv.getFloat32(o + j * 4, true);
    o += n * 4;
    for (let j = 0; j < n; j++) ints[j] = dv.getFloat32(o + j * 4, true);
    o += n * 4;
    out.push({ rt, precursorMz, collisionEnergy: ce, mz, intens: ints });
  }
  return out;
}

/**
 * Extract the best MS2 spectrum near a given retention time and precursor m/z.
 * Returns the merged spectrum from all MS2 scans within the RT window
 * that have a matching precursor m/z.
 */
export function extractMS2Spectrum(
  gz: Uint8Array,
  targetRt: number,
  targetMz: number,
  rtTol = 0.2,
  ppmTol = 20,
): MS2Spectrum | null {
  const scans = unpackMS2Scans(gz);
  if (scans.length === 0) return null;

  const mzWindow = (targetMz * ppmTol) / 1e6;
  const matching = scans.filter(
    (s) =>
      Math.abs(s.rt - targetRt) <= rtTol &&
      (s.precursorMz === 0 || Math.abs(s.precursorMz - targetMz) <= mzWindow),
  );
  if (matching.length === 0) return null;

  // Merge peaks from all matching scans
  const peakMap = new Map<number, number>();
  for (const s of matching) {
    for (let i = 0; i < s.mz.length; i++) {
      const mz = +s.mz[i].toFixed(4);
      const intens = s.intens[i];
      const existing = peakMap.get(mz) ?? 0;
      if (intens > existing) peakMap.set(mz, intens);
    }
  }

  const peaks = Array.from(peakMap.entries())
    .map(([mz, intensity]) => ({ mz, intensity }))
    .sort((a, b) => a.mz - b.mz);

  return {
    precursorMz: targetMz,
    collisionEnergy: matching[0].collisionEnergy,
    rt: matching[0].rt,
    peaks,
  };
}
