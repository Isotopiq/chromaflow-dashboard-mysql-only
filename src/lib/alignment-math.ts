// Retention time alignment algorithms.
// Pure JS — no DOM, no server APIs. Safe for both client and server.

export type LandmarkPair = {
  referenceRt: number;
  observedRt: number;
  shift: number; // referenceRt - observedRt (how much to ADD to observed)
};

export type AlignmentResult = {
  method: "landmark" | "linear";
  /** Per-run shift function: maps observed RT → aligned RT */
  shiftFunction: (rt: number) => number;
  /** Landmark pairs used for alignment */
  landmarks: LandmarkPair[];
  /** Average absolute shift (for reporting) */
  avgShift: number;
  /** R² of the linear fit (for linear method) */
  rSquared: number | null;
};

/**
 * Landmark-based piecewise linear alignment.
 * Uses annotated peaks (matched by analyte_id) as landmarks.
 * Between landmarks, linearly interpolates the shift.
 * Before the first landmark, uses the first shift.
 * After the last landmark, uses the last shift.
 */
export function landmarkAlignment(landmarks: LandmarkPair[]): AlignmentResult {
  if (landmarks.length === 0) {
    return {
      method: "landmark",
      shiftFunction: (rt) => rt,
      landmarks: [],
      avgShift: 0,
      rSquared: null,
    };
  }

  // Sort by observed RT
  const sorted = [...landmarks].sort((a, b) => a.observedRt - b.observedRt);

  const shiftFunction = (rt: number): number => {
    // Before first landmark
    if (rt <= sorted[0].observedRt) return rt + sorted[0].shift;
    // After last landmark
    if (rt >= sorted[sorted.length - 1].observedRt) {
      return rt + sorted[sorted.length - 1].shift;
    }
    // Find bracketing landmarks
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i];
      const hi = sorted[i + 1];
      if (rt >= lo.observedRt && rt <= hi.observedRt) {
        const t = (rt - lo.observedRt) / (hi.observedRt - lo.observedRt);
        const shift = lo.shift + t * (hi.shift - lo.shift);
        return rt + shift;
      }
    }
    return rt; // fallback
  };

  const avgShift = sorted.reduce((s, p) => s + Math.abs(p.shift), 0) / sorted.length;

  return {
    method: "landmark",
    shiftFunction,
    landmarks: sorted,
    avgShift,
    rSquared: null,
  };
}

/**
 * Linear alignment: fits a single linear shift (y = mx + b)
 * where y = referenceRt, x = observedRt.
 * The shift at any RT is (m-1)*rt + b.
 */
export function linearAlignment(landmarks: LandmarkPair[]): AlignmentResult {
  if (landmarks.length === 0) {
    return {
      method: "linear",
      shiftFunction: (rt) => rt,
      landmarks: [],
      avgShift: 0,
      rSquared: null,
    };
  }

  // Linear regression: y = mx + b, where y = ref, x = observed
  const n = landmarks.length;
  const xs = landmarks.map((p) => p.observedRt);
  const ys = landmarks.map((p) => p.referenceRt);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }

  const slope = sxx > 1e-30 ? sxy / sxx : 1;
  const intercept = meanY - slope * meanX;

  // R²
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = slope * xs[i] + intercept;
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - yPred) ** 2;
  }
  const rSquared = ssTot > 1e-30 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  const shiftFunction = (rt: number): number => slope * rt + intercept;

  const avgShift = landmarks.reduce((s, p) => s + Math.abs(p.referenceRt - p.observedRt), 0) / n;

  return {
    method: "linear",
    shiftFunction,
    landmarks,
    avgShift,
    rSquared,
  };
}

/**
 * Build landmark pairs from two sets of annotated peaks.
 * Matches peaks by analyte_id; computes the RT difference.
 */
export function buildLandmarks(
  referencePeaks: Array<{ analyteId?: string; rt: number }>,
  observedPeaks: Array<{ analyteId?: string; rt: number }>,
): LandmarkPair[] {
  const refByAnalyte = new Map<string, number>();
  for (const p of referencePeaks) {
    if (p.analyteId) refByAnalyte.set(p.analyteId, p.rt);
  }
  const pairs: LandmarkPair[] = [];
  for (const p of observedPeaks) {
    if (p.analyteId && refByAnalyte.has(p.analyteId)) {
      const refRt = refByAnalyte.get(p.analyteId)!;
      pairs.push({
        referenceRt: refRt,
        observedRt: p.rt,
        shift: refRt - p.rt,
      });
    }
  }
  return pairs;
}
