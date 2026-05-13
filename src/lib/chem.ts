// Chemistry helpers: parse molecular formula → monoisotopic mass → m/z by adduct.

const ELEMENTS: Record<string, number> = {
  H: 1.0078250319,
  D: 2.0141017778,
  C: 12.0,
  N: 14.0030740052,
  O: 15.9949146221,
  F: 18.998403163,
  Na: 22.98976928,
  Mg: 23.9850417,
  Si: 27.9769265325,
  P: 30.97376163,
  S: 31.97207117,
  Cl: 34.96885268,
  K: 38.96370668,
  Ca: 39.96259098,
  Fe: 55.9349393,
  Br: 78.9183371,
  I: 126.904473,
};

const ELECTRON = 0.00054858;
const PROTON = 1.00727646688;

export type Adduct =
  | "[M+H]+"
  | "[M+Na]+"
  | "[M+K]+"
  | "[M+NH4]+"
  | "[M-H]-"
  | "[M+HCOO]-"
  | "[M+Cl]-";

export function defaultAdduct(ionMode: "positive" | "negative"): Adduct {
  return ionMode === "positive" ? "[M+H]+" : "[M-H]-";
}

export function monoisotopicMass(formula: string): number | null {
  if (!formula) return null;
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m: RegExpExecArray | null;
  let mass = 0;
  let consumed = 0;
  while ((m = re.exec(formula)) !== null) {
    if (!m[1]) continue;
    const el = m[1];
    const cnt = m[2] ? parseInt(m[2], 10) : 1;
    const w = ELEMENTS[el];
    if (w == null) return null;
    mass += w * cnt;
    consumed += m[0].length;
  }
  if (consumed !== formula.replace(/\s+/g, "").length || mass === 0) return null;
  return mass;
}

const ADDUCT_DELTAS: Record<Adduct, { dm: number; charge: number }> = {
  "[M+H]+":   { dm: PROTON,                                charge: +1 },
  "[M+Na]+":  { dm: ELEMENTS.Na - ELECTRON,                charge: +1 },
  "[M+K]+":   { dm: ELEMENTS.K  - ELECTRON,                charge: +1 },
  "[M+NH4]+": { dm: ELEMENTS.N + 4 * ELEMENTS.H - ELECTRON, charge: +1 },
  "[M-H]-":   { dm: -PROTON,                               charge: -1 },
  "[M+HCOO]-":{ dm: ELEMENTS.H + ELEMENTS.C + 2 * ELEMENTS.O + ELECTRON, charge: -1 },
  "[M+Cl]-":  { dm: ELEMENTS.Cl + ELECTRON,                charge: -1 },
};

export function mzFromFormula(formula: string, adduct: Adduct): number | null {
  const mass = monoisotopicMass(formula);
  if (mass == null) return null;
  const a = ADDUCT_DELTAS[adduct];
  return (mass + a.dm) / Math.abs(a.charge);
}

export const ADDUCTS_POS: Adduct[] = ["[M+H]+", "[M+Na]+", "[M+K]+", "[M+NH4]+"];
export const ADDUCTS_NEG: Adduct[] = ["[M-H]-", "[M+HCOO]-", "[M+Cl]-"];
