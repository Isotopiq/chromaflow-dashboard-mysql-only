# Fix: clicking an analyte loads its EIC + populates the peak table

## What's broken today

On `/runs/$runId`:

1. The **bottom Peak Table** is empty for many uploaded runs because the
   raw-file peak picker found nothing. There is literally nothing to click,
   so the EIC card stays on its placeholder message.
2. The **Auto-XIC analyte table** (Phenylalanine, Tryptophan, …) shows
   detected RTs and intensities, but its rows are not clickable. Clicking
   them does not load that analyte's EIC and does not write anything into
   the peak table.

The user wants both flows wired: clicking an analyte loads its EIC and
adds a corresponding row to the peak table for annotation/export.

## Changes

### 1. Server: enrich `getRunEICBatch` with peak metrics

File: `src/lib/lab.functions.ts` (`getRunEICBatch` handler, ~line 413).

For each target, compute alongside the existing `peakRt` / `peakIntensity`:

- `area` — trapezoidal integration of `y` across a window around the apex
  (walk left/right from apex while `y > 0.5 * apex` for FWHM bounds, then
  expand to `0.05 * apex` for area bounds).
- `height` — same as `peakIntensity` (kept for table parity).
- `fwhm` — `xRight − xLeft` at half-max.
- `sn` — `apex / max(1, median(y outside the peak window))`.

Return shape gains `area`, `height`, `fwhm`, `sn` per trace. Existing
fields stay intact so other callers don't break.

### 2. Client: clickable analyte rows + EIC card sync

File: `src/routes/_shell.runs.$runId.tsx`.

- Add `selectedTargetId` state. The Auto-XIC `<TableRow>` gets
  `onClick={() => onSelectTarget(tr.id, t)}` plus a `cursor-pointer` class
  and `bg-accent/40` when selected.
- `onSelectTarget(id, t)` sets the EIC card to render that target's trace
  by reusing `batchQuery.data` (no extra fetch): build
  `eicTrace = { id, name: "${t.name} (${mz.toFixed(4)})", trace: { x, tic: y, bpc: y } }`.
  Also set `customMz = t.mz.toFixed(4)` so the header readout and CSV
  export match. Scroll the EIC card into view (existing `scrollIntoView`).
- EIC card header shows the analyte name when one is selected.

### 3. Client: synthesize peak rows from auto-XIC

Same file. Below the existing `<PeakTable>`:

- Build `derivedPeaks` from `matchRows` whenever
  `run.peaks.length === 0 && batchQuery.data` (one peak per matched
  target with `peakIntensity > 0`). Each row carries the analyte name as
  `analyteName`, plus `rt/area/height/fwhm/sn/mz` from the enriched batch
  payload.
- Render `<PeakTable peaks={run.peaks.length ? run.peaks : derivedPeaks} />`
  with `selectedId` mapped to either the real peak or the synthesized
  `eic-${targetId}` row.
- Header line above the peak table updates to
  "Detected peaks (from Auto-XIC) — click any row to extract its EIC"
  when the synthesized list is in use, with a small badge so the user
  knows these are derived from library extraction, not raw peak picking.
- Clicking a synthesized row calls the same `onSelectTarget` so the EIC
  card and peak table stay in sync.

### 4. Annotation panel

When a synthesized peak is selected, the Annotation card shows the
analyte name as a pre-filled "Suggested" chip. Manual label still works
because `annotatePeak` requires a real `peak.id` — for synthesized peaks
we hide the manual label/save UI and instead show
"Run peak detection on this run to enable annotation" so users aren't
left clicking a Save button that would 404 on the server.

## Out of scope

- Re-running raw peak picking on the server (separate task).
- Persisting auto-XIC peaks to the `peaks` table.
- Per-analyte adduct overrides.

## Files touched

- `src/lib/lab.functions.ts` — extend `getRunEICBatch` return.
- `src/routes/_shell.runs.$runId.tsx` — row click, EIC sync, derived peak
  table, annotation panel guard.

No DB schema or storage changes.
