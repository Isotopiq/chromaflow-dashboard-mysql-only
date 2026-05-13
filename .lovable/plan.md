## Goal

Make XIC actually useful: instead of typing m/z by hand for one peak, give the user a library of analytes (name + molecular formula) and have the app:

1. Compute the expected m/z from each formula + ion mode adduct.
2. Extract the EIC for every selected analyte against the current run's scans blob.
3. Auto-find the best matching peak in each EIC (max intensity within an RT window) and report Δppm / ΔRT.
4. Overlay the resulting EICs on the chromatogram, color-coded by analyte.

Seed the analytes table with ~15 common LC-MS reference compounds so the feature works the moment a run is opened — no manual setup.

## What gets built

### 1. Chemistry utility — `src/lib/chem.ts`
- `monoisotopicMass(formula: string): number` — parses `C8H10N4O2` style strings using a built-in element mass table (H, C, N, O, S, P, Na, K, Cl, F, Br, I, Si, plus a few more).
- `mzFromFormula(formula, adduct)` for these adducts: `[M+H]+`, `[M+Na]+`, `[M+K]+`, `[M+NH4]+`, `[M-H]-`, `[M+HCOO]-`, `[M+Cl]-`. Picks default by ion mode when omitted.
- Returns `null` on unparseable formulas (so bad rows don't break the UI).

### 2. Seed common analytes — new SQL migration
Insert ~15 reference compounds with `library_source = 'system'` so they're shared and survive across users:

```text
Caffeine          C8H10N4O2     rt≈3.8
Acetaminophen     C8H9NO2       rt≈2.1
Theophylline      C7H8N4O2      rt≈3.3
Aspirin           C9H8O4        rt≈4.5
Ibuprofen         C13H18O2      rt≈7.8
Naproxen          C14H14O3      rt≈7.2
Glucose           C6H12O6       rt≈1.2
Sucrose           C12H22O11     rt≈1.5
Tryptophan        C11H12N2O2    rt≈3.1
Phenylalanine     C9H11NO2      rt≈2.7
Tyrosine          C9H11NO3      rt≈1.9
Carnitine         C7H15NO3      rt≈1.4
Reserpine         C33H40N2O9    rt≈8.9
Verapamil         C27H38N2O4    rt≈6.4
Diclofenac        C14H11Cl2NO2  rt≈8.1
```
m/z column is recomputed at insert time using `[M+H]+` so existing UI that reads `analytes.mz` keeps working.

### 3. Server fn — batch EIC extraction
New `getRunEICBatch` in `src/lib/lab.functions.ts`:
- Input: `{ runId, targets: [{ id, mz }], ppm }` (max ~50 targets).
- Downloads + unpacks the scans blob **once**, then loops `extractEIC` per target — much faster than N round-trips.
- Returns `{ x: number[], traces: [{ id, mz, y, mzLow, mzHigh, peakRt, peakIntensity }] }` where `peakRt`/`peakIntensity` are computed server-side as the global max of `y`.

### 4. Run detail page — Auto-XIC panel
New section on `src/routes/_shell.runs.$runId.tsx`, above the existing single-EIC card:

```text
┌─ Auto-XIC from analyte library ───────────────────┐
│ [✓ Caffeine] [✓ Acetaminophen] [ Aspirin] ...     │
│ Adduct: [M+H]+ ▾   ppm: ━━●━━ 10                  │
│                                                    │
│  ┌── overlaid EIC plot (one line per analyte) ──┐ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  Match table:                                     │
│  Analyte       m/z        Δppm   RT obs / exp    │
│  Caffeine      195.0877    3.1   3.79 / 3.80  ✓  │
│  Acetaminophen 152.0712   —      no peak       ✗  │
└────────────────────────────────────────────────────┘
```

- Default selection: all analytes whose computed m/z falls within the run's scan range.
- Calls `getRunEICBatch` (single round-trip).
- Renders one `<Line>` per trace using the same `chromatogram-plot` component, extended to accept multiple labeled series.
- A row in the match table is "matched" when `peakIntensity > noise` AND `|peakRt - rtExpected| ≤ rtTol` (default 1.0 min, slider).
- Clicking a matched row sets the existing `selectedId` so annotation/peak workflow still works.

### 5. Existing single-EIC card stays
Custom-m/z entry remains for ad-hoc lookups; it now shares the same overlay component.

## Why XIC currently looks broken

Two suspects to verify after the panel exists:

1. **Old runs have no `scansBlobPath`** (uploaded before EIC support) — the card already shows the "EIC unavailable" notice for these. New uploads do write the blob.
2. **Custom m/z extracts correctly but returns near-zero** when the typed m/z is outside the scan range or doesn't exist in the data — flat-line is the *correct* answer, but the UI gives no feedback. The new match table makes this obvious by showing "no peak" alongside a known-good analyte for comparison.

If after seeding + Auto-XIC the seeded compounds also come back flat for a file where they're known to be present, that points to a real parsing bug (e.g. mzXML byteOrder still mis-read for the second `<peaks>` element); that's debugged in a follow-up, not in this plan.

## Files touched

- new   `src/lib/chem.ts`
- new   `supabase/migrations/<timestamp>_seed_common_analytes.sql`
- edit  `src/lib/lab.functions.ts`         — add `getRunEICBatch`
- edit  `src/components/chromatogram-plot.tsx` — accept multiple labeled EIC series with a legend
- edit  `src/routes/_shell.runs.$runId.tsx`  — add Auto-XIC panel + match table

## Out of scope (next step if you want it)

- Letting users add their own compounds by typing a formula in the UI (the server fn `addAnalyte` already exists; just needs a small form).
- Adduct multi-select per analyte (e.g. show both `[M+H]+` and `[M+Na]+` as two traces).
- Persisting auto-annotations from the match table back into `peaks.analyte_id`.