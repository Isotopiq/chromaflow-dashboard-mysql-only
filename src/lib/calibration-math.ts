// Calibration curve fitting and quantitation math.
//
// Supports:
//   - Linear regression (ordinary least squares)
//   - Weighted linear regression (1/x, 1/x²)
//   - R² calculation
//   - LOD / LOQ estimation from blank noise or residual std
//   - Concentration back-calculation from response

export type CalibrationPoint = {
  concentration: number;
  response: number;
  excluded?: boolean;
};

export type CurveFit = {
  slope: number;
  intercept: number;
  rSquared: number;
  lod: number | null;
  loq: number | null;
  rangeLow: number;
  rangeHigh: number;
  points: CalibrationPoint[];
};

export type QuadCurveFit = {
  a: number;
  b: number;
  c: number;
  rSquared: number;
  lod: number | null;
  loq: number | null;
  rangeLow: number;
  rangeHigh: number;
  points: CalibrationPoint[];
  residuals: Array<{ conc: number; response: number; predicted: number; residual: number }>;
};

export type Weighting = "none" | "1/x" | "1/x2";

/**
 * Fit a calibration curve using linear or weighted linear regression.
 * y = slope * x + intercept
 */
export function fitLinearCurve(
  points: CalibrationPoint[],
  weighting: Weighting = "none",
  lodN = 3,
  loqN = 10,
): CurveFit | null {
  const active = points.filter((p) => !p.excluded && p.concentration > 0 && p.response > 0);
  if (active.length < 2) return null;

  // Compute weights
  const weights = active.map((p) => {
    if (weighting === "1/x") return 1 / p.concentration;
    if (weighting === "1/x2") return 1 / (p.concentration * p.concentration);
    return 1;
  });

  // Weighted least squares: y = m*x + b
  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (let i = 0; i < active.length; i++) {
    const w = weights[i];
    const x = active[i].concentration;
    const y = active[i].response;
    sw += w;
    swx += w * x;
    swy += w * y;
    swxx += w * x * x;
    swxy += w * x * y;
  }

  const denom = sw * swxx - swx * swx;
  if (Math.abs(denom) < 1e-30) return null;

  const slope = (sw * swxy - swx * swy) / denom;
  const intercept = (swy - slope * swx) / sw;

  // R² (coefficient of determination)
  const meanY = swy / sw;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < active.length; i++) {
    const y = active[i].response;
    const yPred = slope * active[i].concentration + intercept;
    ssTot += weights[i] * (y - meanY) * (y - meanY);
    ssRes += weights[i] * (y - yPred) * (y - yPred);
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  // LOD/LOQ from residual standard deviation
  // LOD = lodN * sigma / slope, LOQ = loqN * sigma / slope
  // sigma = sqrt(SS_res / (n - 2))  (residual std)
  const n = active.length;
  const sigma = n > 2 ? Math.sqrt(ssRes / (n - 2)) : Math.sqrt(ssRes / Math.max(1, n));
  const lod = slope > 0 ? (lodN * sigma) / slope : null;
  const loq = slope > 0 ? (loqN * sigma) / slope : null;

  const concentrations = active.map((p) => p.concentration);
  const rangeLow = Math.min(...concentrations);
  const rangeHigh = Math.max(...concentrations);

  return {
    slope,
    intercept,
    rSquared,
    lod,
    loq,
    rangeLow,
    rangeHigh,
    points: active,
  };
}

/**
 * Back-calculate concentration from a response using a fitted curve.
 * x = (y - intercept) / slope
 */
export function calcConcentration(
  response: number,
  slope: number,
  intercept: number,
): number | null {
  if (Math.abs(slope) < 1e-30) return null;
  const conc = (response - intercept) / slope;
  return conc > 0 ? conc : 0;
}

/**
 * Calculate accuracy (%) = (measured / expected) * 100
 */
export function calcAccuracy(measured: number, expected: number): number {
  if (expected === 0) return 0;
  return (measured / expected) * 100;
}

/**
 * Check if a QC sample passes acceptance criteria.
 */
export function qcPassed(accuracyPct: number, acceptancePct: number): boolean {
  const deviation = Math.abs(accuracyPct - 100);
  return deviation <= acceptancePct;
}

/**
 * Calculate RSD (relative standard deviation) as a percentage.
 */
export function rsdPct(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sq, v) => sq + (v - mean) * (v - mean), 0) /
    (values.length - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

// ---- System Suitability (USP/EP) ----

/**
 * USP tailing factor: T = W_0.05 / (2 * f)
 * where W_0.05 = peak width at 5% height, f = distance from peak front to apex at 5% height.
 * Simplified: uses asymmetry factor if available.
 */
export function uspTailingFactor(
  peakWidthAt5pctHeight: number,
  frontToApexAt5pct: number,
): number {
  if (frontToApexAt5pct === 0) return 1;
  return peakWidthAt5pctHeight / (2 * frontToApexAt5pct);
}

/**
 * USP plate count: N = 5.54 * (tR / W_0.5)²
 * where tR = retention time, W_0.5 = peak width at half height (FWHM).
 */
export function uspPlateCount(retentionTime: number, fwhm: number): number {
  if (fwhm <= 0) return 0;
  return 5.54 * Math.pow(retentionTime / fwhm, 2);
}

/**
 * USP resolution: Rs = 2 * (tR2 - tR1) / (W1 + W2)
 * where tR = retention time, W = baseline peak width.
 */
export function uspResolution(
  tr1: number, tr2: number,
  w1: number, w2: number,
): number {
  const denom = w1 + w2;
  if (denom === 0) return 0;
  return (2 * Math.abs(tr2 - tr1)) / denom;
}

/**
 * Signal-to-noise ratio: S/N = peak_height / noise
 * where noise = std dev of baseline (or RMS noise).
 */
export function signalToNoise(peakHeight: number, noise: number): number {
  if (noise <= 0) return peakHeight > 0 ? Infinity : 0;
  return peakHeight / noise;
}

export type SSTResult = {
  criterion: string;
  value: number;
  unit: string;
  spec: string;
  passed: boolean;
};

export type SSTCriteria = {
  rsdMaxPct: number;          // max RSD% for retention time / area
  tailingMin: number;         // min acceptable tailing factor
  tailingMax: number;         // max acceptable tailing factor
  platesMin: number;          // min plate count
  resolutionMin: number;      // min resolution between critical pairs
  snMin: number;              // min signal-to-noise
};

export const DEFAULT_SST_CRITERIA: SSTCriteria = {
  rsdMaxPct: 2.0,
  tailingMin: 0.8,
  tailingMax: 2.0,
  platesMin: 2000,
  resolutionMin: 1.5,
  snMin: 10,
};

export function runSystemSuitability(
  replicates: Array<{
    rt: number;
    area: number;
    fwhm: number;
    height: number;
    sn: number;
    tailing?: number;
  }>,
  criteria: SSTCriteria = DEFAULT_SST_CRITERIA,
): SSTResult[] {
  const results: SSTResult[] = [];

  if (replicates.length === 0) return results;

  // RT reproducibility
  const rtRsd = rsdPct(replicates.map((r) => r.rt));
  results.push({
    criterion: "RT RSD%",
    value: rtRsd,
    unit: "%",
    spec: `≤ ${criteria.rsdMaxPct}%`,
    passed: rtRsd <= criteria.rsdMaxPct,
  });

  // Area reproducibility
  const areaRsd = rsdPct(replicates.map((r) => r.area));
  results.push({
    criterion: "Area RSD%",
    value: areaRsd,
    unit: "%",
    spec: `≤ ${criteria.rsdMaxPct}%`,
    passed: areaRsd <= criteria.rsdMaxPct,
  });

  // Tailing factor (average)
  const tailings = replicates.map((r) => r.tailing ?? 1);
  const avgTailing = tailings.reduce((a, b) => a + b, 0) / tailings.length;
  results.push({
    criterion: "Tailing factor",
    value: avgTailing,
    unit: "",
    spec: `${criteria.tailingMin}–${criteria.tailingMax}`,
    passed: avgTailing >= criteria.tailingMin && avgTailing <= criteria.tailingMax,
  });

  // Plate count (average)
  const plates = replicates.map((r) => uspPlateCount(r.rt, r.fwhm));
  const avgPlates = plates.reduce((a, b) => a + b, 0) / plates.length;
  results.push({
    criterion: "Plate count (USP)",
    value: avgPlates,
    unit: "",
    spec: `≥ ${criteria.platesMin}`,
    passed: avgPlates >= criteria.platesMin,
  });

  // S/N (average)
  const sns = replicates.map((r) => r.sn);
  const avgSn = sns.reduce((a, b) => a + b, 0) / sns.length;
  results.push({
    criterion: "S/N ratio",
    value: avgSn,
    unit: "",
    spec: `≥ ${criteria.snMin}`,
    passed: avgSn >= criteria.snMin,
  });

  return results;
}

// ---- Quadratic curve fitting ----

/**
 * Fit a quadratic calibration curve y = a*x² + b*x + c using ordinary least squares.
 * Computes R², LOD/LOQ from residual standard deviation, and per-point residuals.
 */
export function fitQuadraticCurve(
  points: CalibrationPoint[],
  lodN = 3,
  loqN = 10,
): QuadCurveFit | null {
  const active = points.filter((p) => !p.excluded && p.concentration > 0 && p.response > 0);
  if (active.length < 3) return null;

  // Build normal equations for y = a*x² + b*x + c:
  //   [ Σx⁴  Σx³  Σx² ] [a]   [Σx²y]
  //   [ Σx³  Σx²  Σx  ] [b] = [Σxy ]
  //   [ Σx²  Σx   Σ1  ] [c]   [Σy  ]
  const n = active.length;
  let s4 = 0, s3 = 0, s2 = 0, s1 = 0, s0 = n;
  let s2y = 0, s1y = 0, s0y = 0;

  for (let i = 0; i < n; i++) {
    const x = active[i].concentration;
    const y = active[i].response;
    const x2 = x * x;
    const x3 = x2 * x;
    const x4 = x3 * x;
    s4 += x4; s3 += x3; s2 += x2; s1 += x;
    s2y += x2 * y; s1y += x * y; s0y += y;
  }

  // Solve 3×3 system via Cramer's rule.
  const det =
    s4 * (s2 * s0 - s1 * s1) -
    s3 * (s3 * s0 - s1 * s2) +
    s2 * (s3 * s1 - s2 * s2);
  if (Math.abs(det) < 1e-30) return null;

  const a =
    (s2y * (s2 * s0 - s1 * s1) -
      s1y * (s3 * s0 - s1 * s2) +
      s0y * (s3 * s1 - s2 * s2)) / det;
  const b =
    (s4 * (s1y * s0 - s0y * s1) -
      s3 * (s2y * s0 - s0y * s2) +
      s2 * (s2y * s1 - s1y * s2)) / det;
  const c =
    (s4 * (s2 * s0y - s1 * s1y) -
      s3 * (s3 * s0y - s1 * s2y) +
      s2 * (s3 * s1y - s2 * s2y)) / det;

  // Predicted values and residuals.
  const residuals: Array<{ conc: number; response: number; predicted: number; residual: number }> = [];
  let ssRes = 0;
  let ssTot = 0;
  const meanY = s0y / n;
  for (let i = 0; i < n; i++) {
    const x = active[i].concentration;
    const y = active[i].response;
    const yPred = a * x * x + b * x + c;
    const resid = y - yPred;
    ssRes += resid * resid;
    ssTot += (y - meanY) * (y - meanY);
    residuals.push({ conc: x, response: y, predicted: yPred, residual: resid });
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  // LOD/LOQ from residual standard deviation.
  // sigma = sqrt(SS_res / (n - 3))  (3 parameters fitted)
  // We approximate the slope at the centroid for LOD/LOQ conversion.
  const sigma = n > 3 ? Math.sqrt(ssRes / (n - 3)) : Math.sqrt(ssRes / Math.max(1, n));
  const meanX = s1 / n;
  const slopeAtCentroid = 2 * a * meanX + b;
  const lod = slopeAtCentroid > 0 ? (lodN * sigma) / slopeAtCentroid : null;
  const loq = slopeAtCentroid > 0 ? (loqN * sigma) / slopeAtCentroid : null;

  const concentrations = active.map((p) => p.concentration);
  const rangeLow = Math.min(...concentrations);
  const rangeHigh = Math.max(...concentrations);

  return {
    a,
    b,
    c,
    rSquared,
    lod,
    loq,
    rangeLow,
    rangeHigh,
    points: active,
    residuals,
  };
}

/**
 * Back-calculate concentration from a response using a fitted quadratic curve.
 * Solves a*x² + b*x + (c - y) = 0 for x, returns the positive root.
 */
export function calcConcentrationQuad(
  response: number,
  a: number,
  b: number,
  c: number,
): number | null {
  // Rearrange y = a*x² + b*x + c  →  a*x² + b*x + (c - y) = 0
  const cc = c - response;

  if (Math.abs(a) < 1e-30) {
    // Degenerate to linear: b*x + cc = 0
    if (Math.abs(b) < 1e-30) return null;
    const x = -cc / b;
    return x > 0 ? x : 0;
  }

  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const x1 = (-b + sqrtDisc) / (2 * a);
  const x2 = (-b - sqrtDisc) / (2 * a);

  // Prefer the smallest positive root (physically meaningful concentration).
  const candidates = [x1, x2].filter((x) => x > 0);
  if (candidates.length === 0) return 0;
  return Math.min(...candidates);
}
