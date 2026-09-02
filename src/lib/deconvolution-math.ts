// Peak deconvolution via second-derivative analysis.
//
// Given an EIC (extracted ion chromatogram) segment, this module estimates the
// number of hidden Gaussian components that make up an observed (possibly
// overlapped) peak. It uses a smoothed second derivative to locate zero
// crossings — each negative-to-positive crossing of the 2nd derivative
// corresponds to the center of an underlying Gaussian component — then fits
// each component with a simple Gaussian and integrates it to get the area.

export type DeconvComponent = {
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  gaussianParams: [amplitude: number, center: number, sigma: number];
};

export type DeconvResult = {
  componentCount: number;
  components: DeconvComponent[];
  residualError: number;
};

/** Gaussian value at x. */
function gaussian(x: number, amp: number, center: number, sigma: number): number {
  if (sigma === 0) return x === center ? amp : 0;
  return amp * Math.exp(-((x - center) ** 2) / (2 * sigma * sigma));
}

/** Trapezoidal integration of a function over a uniform grid. */
function trapezoidalArea(
  amp: number,
  center: number,
  sigma: number,
  xStart: number,
  xEnd: number,
  steps = 200,
): number {
  if (xEnd <= xStart || steps < 1) return 0;
  const dx = (xEnd - xStart) / steps;
  let area = 0;
  let prev = gaussian(xStart, amp, center, sigma);
  for (let i = 1; i <= steps; i++) {
    const x = xStart + i * dx;
    const v = gaussian(x, amp, center, sigma);
    area += ((prev + v) / 2) * dx;
    prev = v;
  }
  return area;
}

/**
 * Smoothed second derivative via a simple finite-difference with a small
 * moving-average pre-smoothing window. This is a lightweight stand-in for a
 * Savitzky-Golay filter and avoids external dependencies.
 */
function smoothedSecondDerivative(y: number[], win = 3): number[] {
  const n = y.length;
  if (n < 5) return new Array(n).fill(0);

  // Moving-average smoothing.
  const half = Math.max(1, Math.floor(win / 2));
  const smooth: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      sum += y[j];
      count++;
    }
    smooth[i] = sum / count;
  }

  // Second derivative via central finite difference.
  const d2: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    d2[i] = smooth[i + 1] - 2 * smooth[i] + smooth[i - 1];
  }
  return d2;
}

/** Find indices where the second derivative crosses zero (neg -> pos). */
function findZeroCrossings(d2: number[]): number[] {
  const crossings: number[] = [];
  for (let i = 1; i < d2.length; i++) {
    if (d2[i - 1] < 0 && d2[i] >= 0) {
      // Linear interpolation for a sub-sample crossing index.
      const frac = d2[i - 1] === d2[i] ? 0 : -d2[i - 1] / (d2[i] - d2[i - 1]);
      crossings.push(i - 1 + frac);
    }
  }
  return crossings;
}

/**
 * Estimate the full-width half-max (in x units) around a center index by
 * walking outward from the peak until the signal drops below half-height.
 */
function estimateFwhm(x: number[], y: number[], centerIdx: number): number {
  const n = y.length;
  const peakVal = y[Math.round(centerIdx)] ?? 0;
  if (peakVal <= 0) return 0;
  const half = peakVal / 2;

  let left = Math.round(centerIdx);
  while (left > 0 && y[left] > half) left--;
  let right = Math.round(centerIdx);
  while (right < n - 1 && y[right] > half) right++;

  const xLeft = x[Math.max(0, left)];
  const xRight = x[Math.min(n - 1, right)];
  return Math.abs(xRight - xLeft);
}

/**
 * Simple iterative refinement of a single Gaussian's parameters (amplitude,
 * center, sigma) using a few rounds of weighted least-squares-like updates.
 * Keeps things dependency-free and bounded.
 */
function refineGaussian(
  x: number[],
  y: number[],
  amp0: number,
  center0: number,
  sigma0: number,
  iters = 20,
): { amp: number; center: number; sigma: number } {
  let amp = amp0;
  let center = center0;
  let sigma = sigma0;

  for (let it = 0; it < iters; it++) {
    let sA = 0, sC = 0, sS = 0;
    let nA = 0, nC = 0, nS = 0;

    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = y[i];
      if (sigma <= 0) break;
      const g = gaussian(xi, amp, center, sigma);
      const resid = yi - g;
      const denom = Math.max(g, 1e-9);

      // Gradient-ish updates (Gauss-Newton flavor).
      const dA = g / Math.max(amp, 1e-9);
      const dC = g * (xi - center) / (sigma * sigma);
      const dS = g * ((xi - center) ** 2) / (sigma * sigma * sigma);

      sA += dA * resid;
      nA += dA * dA;
      sC += dC * resid;
      nC += dC * dC;
      sS += dS * resid;
      nS += dS * dS;
    }

    const stepA = nA > 0 ? sA / nA : 0;
    const stepC = nC > 0 ? sC / nC : 0;
    const stepS = nS > 0 ? sS / nS : 0;

    amp = Math.max(1e-9, amp + stepA);
    center = center + stepC;
    sigma = Math.max(1e-6, sigma + stepS);

    // Damp large jumps.
    if (!Number.isFinite(amp) || !Number.isFinite(center) || !Number.isFinite(sigma)) {
      return { amp: amp0, center: center0, sigma: sigma0 };
    }
  }

  return { amp, center, sigma };
}

/**
 * Deconvolve an overlapped peak in an EIC segment.
 *
 * Steps:
 *  1. Extract the EIC segment between rtStart and rtEnd.
 *  2. Compute a smoothed second derivative.
 *  3. Find zero crossings (negative -> positive) which indicate hidden
 *     Gaussian component centers.
 *  4. For each component, estimate initial Gaussian params.
 *  5. Refine each Gaussian fit.
 *  6. Integrate each fitted Gaussian (trapezoidal) for the area.
 *  7. Return components sorted by area descending.
 *  8. If only 1 component is detected, return the original peak as-is.
 */
export function deconvolvePeak(
  x: number[],
  y: number[],
  rtStart: number,
  rtEnd: number,
): DeconvResult {
  if (x.length !== y.length || x.length < 3) {
    return { componentCount: 0, components: [], residualError: 0 };
  }

  // 1. Extract the EIC segment.
  const segX: number[] = [];
  const segY: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] >= rtStart && x[i] <= rtEnd) {
      segX.push(x[i]);
      segY.push(y[i]);
    }
  }

  if (segX.length < 3) {
    return { componentCount: 0, components: [], residualError: 0 };
  }

  // 2. Smoothed second derivative.
  const d2 = smoothedSecondDerivative(segY);

  // 3. Zero crossings (negative -> positive) indicate component centers.
  const crossings = findZeroCrossings(d2);

  // 4-5. Estimate + refine Gaussian params for each component.
  const components: DeconvComponent[] = [];

  if (crossings.length === 0) {
    // No crossings: treat the whole segment as a single component.
    const peakIdx = segY.indexOf(Math.max(...segY));
    const center = segX[peakIdx];
    const amp = segY[peakIdx];
    const fwhm = estimateFwhm(segX, segY, peakIdx);
    const sigma = fwhm > 0 ? fwhm / 2.3548 : (segX[segX.length - 1] - segX[0]) / 6;
    const refined = refineGaussian(segX, segY, amp, center, sigma);
    const area = trapezoidalArea(refined.amp, refined.center, refined.sigma, segX[0], segX[segX.length - 1]);
    components.push({
      rt: refined.center,
      area,
      height: refined.amp,
      fwhm: 2.3548 * refined.sigma,
      gaussianParams: [refined.amp, refined.center, refined.sigma],
    });
  } else {
    for (const crossing of crossings) {
      const idx = Math.round(crossing);
      const center = segX[idx] ?? segX[0];
      const amp = Math.max(0, segY[idx] ?? 0);
      const fwhm = estimateFwhm(segX, segY, idx);
      const sigma = fwhm > 0 ? fwhm / 2.3548 : (segX[segX.length - 1] - segX[0]) / 6;
      const refined = refineGaussian(segX, segY, amp, center, sigma);
      const area = trapezoidalArea(refined.amp, refined.center, refined.sigma, segX[0], segX[segX.length - 1]);
      components.push({
        rt: refined.center,
        area,
        height: refined.amp,
        fwhm: 2.3548 * refined.sigma,
        gaussianParams: [refined.amp, refined.center, refined.sigma],
      });
    }
  }

  // 6. Residual error: RMS of (observed - sum of fitted Gaussians).
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < segX.length; i++) {
    let model = 0;
    for (const c of components) {
      model += gaussian(segX[i], c.gaussianParams[0], c.gaussianParams[1], c.gaussianParams[2]);
    }
    const resid = segY[i] - model;
    sumSq += resid * resid;
    count++;
  }
  const residualError = count > 0 ? Math.sqrt(sumSq / count) : 0;

  // 7. Sort by area descending.
  components.sort((a, b) => b.area - a.area);

  // 8. Single-component shortcut.
  if (components.length === 1) {
    return { componentCount: 1, components, residualError };
  }

  return { componentCount: components.length, components, residualError };
}
