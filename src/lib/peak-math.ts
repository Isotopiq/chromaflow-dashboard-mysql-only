// Pure helpers for manual peak integration over an EIC trace.
// All math is client-safe (no DOM, no server APIs).

export type IntegrationResult = {
  rtStart: number;
  rtEnd: number;
  apexRt: number;
  height: number; // baseline-subtracted apex
  area: number; // baseline-subtracted, trapezoidal
  fwhm: number; // min, baseline-subtracted half-max
  sn: number; // apex / median(|y - b|) outside band
  baselineLeft: number;
  baselineRight: number;
};

function findIndex(xs: number[], t: number): number {
  // Closest index to t; assumes xs is sorted ascending.
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  // Pick whichever neighbor is closer.
  if (lo > 0 && Math.abs(xs[lo - 1] - t) < Math.abs(xs[lo] - t)) return lo - 1;
  return lo;
}

export function integrateBand(
  x: number[],
  y: number[],
  rtStart: number,
  rtEnd: number,
): IntegrationResult | null {
  if (x.length < 2 || y.length !== x.length) return null;
  const a = Math.min(rtStart, rtEnd);
  const b = Math.max(rtStart, rtEnd);
  let il = findIndex(x, a);
  let ir = findIndex(x, b);
  if (il > ir) [il, ir] = [ir, il];
  if (ir - il < 1) return null;

  const xl = x[il];
  const xr = x[ir];
  const yl = y[il];
  const yr = y[ir];
  const span = xr - xl || 1;

  const baseline = (t: number) => yl + ((yr - yl) * (t - xl)) / span;

  // Apex (baseline-subtracted)
  let apex = 0;
  let apexIdx = il;
  for (let i = il; i <= ir; i++) {
    const v = y[i] - baseline(x[i]);
    if (v > apex) {
      apex = v;
      apexIdx = i;
    }
  }
  const apexRt = x[apexIdx];

  // Area: trapezoidal of (y - baseline), clamp negatives to 0.
  let area = 0;
  for (let i = il; i < ir; i++) {
    const v0 = Math.max(0, y[i] - baseline(x[i]));
    const v1 = Math.max(0, y[i + 1] - baseline(x[i + 1]));
    area += ((v0 + v1) / 2) * (x[i + 1] - x[i]);
  }

  // FWHM
  let fwhm = 0;
  if (apex > 0) {
    const half = apex / 2;
    let l = apexIdx;
    while (l > il && y[l] - baseline(x[l]) > half) l--;
    let r = apexIdx;
    while (r < ir && y[r] - baseline(x[r]) > half) r++;
    fwhm = Math.max(0, x[r] - x[l]);
  }

  // S/N: apex / median(|y - baseline-extended|) outside [il, ir]
  // Use a flat noise estimate from the global y outside the band.
  const noise: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (i < il || i > ir) noise.push(Math.abs(y[i]));
  }
  let med = 0;
  if (noise.length > 0) {
    noise.sort((p, q) => p - q);
    med = noise[Math.floor(noise.length / 2)];
  }
  const sn = apex / Math.max(1, med);

  return {
    rtStart: xl,
    rtEnd: xr,
    apexRt,
    height: apex,
    area,
    fwhm,
    sn,
    baselineLeft: yl,
    baselineRight: yr,
  };
}
