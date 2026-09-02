// Adduct and in-source fragment detection.
//
// Given a neutral (monoisotopic) mass and an observed m/z, this module checks
// whether the observed m/z matches any of a set of common adducts within a
// ppm tolerance. It can also scan a list of peaks to find which ones are
// likely adducts / in-source fragments of a given analyte.

import { monoisotopicMass, type Adduct } from "@/lib/chem";

export type AdductMatch = {
  adductType: string;
  mzTheoretical: number;
  ppmError: number;
  isInSourceFragment: boolean;
};

// Electron mass (Da) and proton mass (Da) — kept consistent with chem.ts.
const ELECTRON = 0.00054858;
const PROTON = 1.00727646688;

// Element masses needed for adduct/fragment deltas.
const H = 1.0078250319;
const C = 12.0;
const N = 14.0030740052;
const O = 15.9949146221;
const Na = 22.98976928;
const K = 38.96370668;
const Cl = 34.96885268;

/**
 * Common positive-mode adducts and in-source fragments.
 * `dm` is the mass delta added to (or removed from) the neutral mass M before
 * dividing by the absolute charge. For in-source fragments, `dm` represents a
 * neutral loss applied on top of the protonation.
 */
export const COMMON_ADDUCTS_POS: Array<{ name: string; dm: number; charge: number }> = [
  { name: "[M+H]+",        dm: PROTON,                                 charge: 1 },
  { name: "[M+Na]+",       dm: Na - ELECTRON,                          charge: 1 },
  { name: "[M+K]+",        dm: K - ELECTRON,                           charge: 1 },
  { name: "[M+NH4]+",      dm: N + 4 * H - ELECTRON,                   charge: 1 },
  { name: "[M+2H]2+",      dm: 2 * PROTON,                             charge: 2 },
  { name: "[M+H-H2O]+",    dm: PROTON - 2 * H - O,                     charge: 1 }, // in-source fragment
  { name: "[M+H-NH3]+",    dm: PROTON - N - 3 * H,                     charge: 1 }, // in-source fragment
];

/**
 * Common negative-mode adducts and in-source fragments.
 */
export const COMMON_ADDUCTS_NEG: Array<{ name: string; dm: number; charge: number }> = [
  { name: "[M-H]-",        dm: -PROTON,                                charge: 1 },
  { name: "[M+HCOO]-",     dm: H + C + 2 * O + ELECTRON,               charge: 1 },
  { name: "[M+Cl]-",       dm: Cl + ELECTRON,                          charge: 1 },
  { name: "[M-2H]2-",      dm: -2 * PROTON,                            charge: 2 },
  { name: "[M-H-H2O]-",    dm: -PROTON - 2 * H - O,                    charge: 1 }, // in-source fragment
  { name: "[M-H-CO2]-",    dm: -PROTON - C - 2 * O,                    charge: 1 }, // in-source fragment
];

/** Names that represent in-source fragments (neutral losses), not true adducts. */
const IN_SOURCE_FRAGMENT_NAMES = new Set([
  "[M+H-H2O]+",
  "[M+H-NH3]+",
  "[M-H-H2O]-",
  "[M-H-CO2]-",
]);

/** Theoretical m/z for a neutral mass + adduct delta. */
function mzForAdduct(neutralMass: number, dm: number, charge: number): number {
  return (neutralMass + dm) / Math.abs(charge);
}

/** ppm error between observed and theoretical m/z. */
function ppmError(observed: number, theoretical: number): number {
  if (theoretical === 0) return Infinity;
  return ((observed - theoretical) / theoretical) * 1e6;
}

/**
 * Check every common adduct (for the given ion mode) against an observed m/z.
 * Returns all matches within `ppmTol`, sorted by absolute ppm error.
 */
export function detectAdducts(
  neutralMass: number,
  observedMz: number,
  ionMode: "positive" | "negative",
  ppmTol: number,
): AdductMatch[] {
  const list = ionMode === "positive" ? COMMON_ADDUCTS_POS : COMMON_ADDUCTS_NEG;
  const matches: AdductMatch[] = [];

  for (const a of list) {
    const mzTheo = mzForAdduct(neutralMass, a.dm, a.charge);
    const err = ppmError(observedMz, mzTheo);
    if (Math.abs(err) <= ppmTol) {
      matches.push({
        adductType: a.name,
        mzTheoretical: mzTheo,
        ppmError: err,
        isInSourceFragment: IN_SOURCE_FRAGMENT_NAMES.has(a.name),
      });
    }
  }

  matches.sort((a, b) => Math.abs(a.ppmError) - Math.abs(b.ppmError));
  return matches;
}

/**
 * Scan a list of peaks and find those that are adducts / in-source fragments
 * of the given neutral analyte mass. Each returned entry describes the peak
 * and the best-matching adduct type.
 */
export function findAdductPeaks(
  analyteMass: number,
  ionMode: "positive" | "negative",
  allPeaks: Array<{ mz: number; rt: number; area: number }>,
  ppmTol: number,
): Array<{ peakMz: number; rt: number; area: number; adductType: string; ppmError: number }> {
  const out: Array<{ peakMz: number; rt: number; area: number; adductType: string; ppmError: number }> = [];

  for (const peak of allPeaks) {
    const matches = detectAdducts(analyteMass, peak.mz, ionMode, ppmTol);
    if (matches.length > 0) {
      const best = matches[0];
      out.push({
        peakMz: peak.mz,
        rt: peak.rt,
        area: peak.area,
        adductType: best.adductType,
        ppmError: best.ppmError,
      });
    }
  }

  // Sort by ascending ppm error for convenience.
  out.sort((a, b) => Math.abs(a.ppmError) - Math.abs(b.ppmError));
  return out;
}

// Re-export so callers can compute a neutral mass from a formula string
// (the common entry point before calling detectAdducts / findAdductPeaks).
export { monoisotopicMass, type Adduct };
