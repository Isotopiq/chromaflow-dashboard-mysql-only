## Goal
Fix the broken peak→EIC interaction and let the user manage their own compound library (add / edit / delete) with both positive- and negative-mode adducts.

## A. Peak click → EIC

The peak table sets `selectedId` correctly, but `eicMz` falls back to `selected.mz`. When the parser didn't attach an m/z to a peak (common for some mzXML files), the UI still shows "Select a peak from the table below" — looks like the click was ignored.

Changes in `src/routes/_shell.runs.$runId.tsx`:
- Show the selected peak's RT in the EIC card header as soon as a row is clicked, regardless of m/z availability.
- Replace the "Select a peak…" placeholder with a context-aware message:
  - no peak selected and no custom m/z → current message
  - peak selected but `selected.mz == null` → "Selected peak at RT {x} has no associated m/z. Type a custom m/z above (or pick a compound from the library) to extract its EIC."
- Auto-fill the `customMz` input with the strongest m/z from the selected peak window when available; otherwise leave blank.
- Scroll the EIC card into view when a peak is clicked (smooth `scrollIntoView`) so users see the click registered.

## B. Compound library CRUD

### Server (`src/lib/lab.functions.ts`)
- New `updateAnalyte({ id, name, formula, mz, rtExpected })` — ownership-checked: only rows where `created_by = userId` can be modified (system-seeded compounds remain read-only).
- New `deleteAnalyte({ id })` — same ownership rule.
- Loosen `addAnalyte` so `mz` is optional; if omitted, server computes m/z from `formula` using `mzFromFormula(formula, "[M+H]+")` and rejects if formula is unparseable.

### Store (`src/lib/store.ts`)
- Add `updateAnalyteLocal(a)` and `removeAnalyteLocal(id)`.

### Library page (`src/routes/_shell.analytes.tsx`)
The current page is a heatmap-only view. Wrap it in tabs and add a **Library** tab containing:
- Table: name, formula, neutral mass, [M+H]+ m/z, [M-H]- m/z, expected RT, source badge (system/user), edit + delete actions (delete/edit only enabled for user-owned rows).
- "Add compound" form (also reused for Edit dialog):
  - inputs: name, molecular formula, expected RT, optional manual m/z override
  - live preview of monoisotopic mass and computed m/z for both `[M+H]+` and `[M-H]-`
  - Save button disabled until formula parses (or manual m/z provided)

Keep the existing matrix view as the second tab so the page stays useful.

## C. Negative-mode adducts in Auto-XIC
- Already partially supported via `ADDUCTS_NEG`. Add a **Mode** override toggle (Positive / Negative) in the Auto-XIC header so a user can audit a run in either polarity. Default still follows `run.ionMode`. The adduct dropdown switches its options based on the toggle.
- Add `[M+FA-H]-` (formate) is already there; nothing else to add chem-side.

## Out of scope
- Per-analyte adduct override (one global adduct continues to apply to all selected analytes).
- Bulk CSV import / export of analytes.
- Re-extracting `peak.mz` from raw scans for older runs whose parser left it null (parser-side change).

## Files
- edit `src/lib/lab.functions.ts` (add update/delete analyte, loosen add)
- edit `src/lib/store.ts` (two new local actions)
- edit `src/routes/_shell.analytes.tsx` (add Library tab + CRUD UI, keep matrix)
- edit `src/routes/_shell.runs.$runId.tsx` (better peak-click feedback, mode override toggle)