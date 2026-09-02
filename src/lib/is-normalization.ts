// Internal Standard (IS) normalization math.
//
// Provides pure-JS utilities for:
//   - Normalizing analyte peak areas by IS peak area
//   - Computing IS recovery metrics (mean, RSD%, linear trend)

/**
 * Normalize an analyte peak area by the internal standard peak area.
 * Returns analyteArea / isArea, or null if isArea is zero (or non-finite).
 */
export function normalizeByIS(analyteArea: number, isArea: number): number | null {
  if (!Number.isFinite(analyteArea) || !Number.isFinite(isArea)) return null;
  if (isArea === 0) return null;
  return analyteArea / isArea;
}

/**
 * Compute IS recovery statistics across a sequence of injections.
 *
 * @param isAreas - Array of IS peak areas, ordered by injection number.
 * @returns `{ mean, rsd, trend }` where:
 *   - mean  = arithmetic mean of the areas
 *   - rsd   = relative standard deviation (%)
 *   - trend = slope of the linear regression of area vs injection index
 *             (a negative trend suggests IS degradation / drift over the run)
 */
export function calculateISRecovery(isAreas: number[]): {
  mean: number;
  rsd: number;
  trend: number;
} {
  const n = isAreas.length;
  if (n === 0) return { mean: 0, rsd: 0, trend: 0 };

  // Mean
  const sum = isAreas.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  // RSD% (relative standard deviation)
  let rsd = 0;
  if (n >= 2 && mean !== 0) {
    const variance =
      isAreas.reduce((sq, v) => sq + (v - mean) * (v - mean), 0) / (n - 1);
    rsd = (Math.sqrt(variance) / mean) * 100;
  }

  // Linear trend (slope of area vs injection index 0..n-1)
  // slope = (n * Σ(xy) - Σx * Σy) / (n * Σx² - (Σx)²)
  let trend = 0;
  if (n >= 2) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = isAreas[i];
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) > 1e-30) {
      trend = (n * sxy - sx * sy) / denom;
    }
  }

  return { mean, rsd, trend };
}
