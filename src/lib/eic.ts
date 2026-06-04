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
