# Peak detection overhaul + peak-table fix

Two problems, one plan:

1. The current picker in `src/workers/mzml.worker.ts` (`pickTracePeaks`) is a simple SG5 + local-max + half-max walk. It misses shoulders, splits noisy peaks, and has no shape validation — far from "impeccable".
2. In `src/routes/_shell.runs.$runId.tsx` the table only shows `run.peaks` (or `derivedPeaks` as a fallback). Newly-picked or manually-integrated RTs sometimes don't surface because (a) some runs are still rendered through the "derived" fallback even after detection completes, and (b) manually integrated peaks are saved server-side but the local store/UI doesn't always re-sort or reset the page, so the new RT is hidden on a later page.

## 1. Validated peak picker (CentWave-inspired)

CentWave (Tautenhahn et al., *BMC Bioinformatics* 2008) is the de-facto validated algorithm in XCMS/MZmine. We will port a faithful TS implementation into the existing worker so it stays fully client-side (no new server cost, no Python).

New module: `src/workers/peak-picker.ts`

Pipeline per mass trace (`MassTrace` already built in the worker):

1. **ROI confirmation** — keep regions with ≥ `minPoints` (default 5) consecutive non-zero scans within `ppm` tolerance; gap-fill up to `maxGap` (already done by `buildMassTraces`, we just tighten thresholds).
2. **Continuous Wavelet Transform (Mexican-hat / Ricker)** on the EIC at scales matching expected FWHM (0.02–0.6 min). Scales chosen from method `expected_fwhm` if available, else a log-spaced default set.
3. **Ridge-line detection** across scales (Du, Yang, Liang 2006) to locate apex candidates that persist across multiple scales — this is what gives CentWave its noise rejection.
4. **Boundary refinement** on the raw EIC: walk outward from apex until signal returns to local baseline (rolling min of lower-half MAD), then refine to the nearest inflection point.
5. **Shape validation gate** — reject the candidate unless all are true:
   - S/N ≥ `snThreshold` (default 5; configurable per method)
   - FWHM within `[fwhmMin, fwhmMax]` (defaults 0.01–1.5 min, overridable per method)
   - Gaussian-fit R² ≥ 0.80 (least-squares fit on baseline-subtracted apex window) — this is the "validated" check that separates real peaks from noise spikes and ghost ions
   - Asymmetry factor (10% height) between 0.6 and 2.5
   - Apex within ±1 scan of the CWT-predicted apex
6. **Deduplication** — same ±5 ppm / ±0.05 min rule we already use, but keep the higher-R² candidate, not just the larger area.

Tunables flow through `LabSettings` (already exists). Add a `peakDetection` block:
```
peakDetection: {
  ppm: number;            // default 10
  snThreshold: number;    // default 5
  fwhmMin: number;        // min, default 0.01
  fwhmMax: number;        // max, default 1.5
  minR2: number;          // default 0.80
  intensityThreshold: number; // absolute floor, default 1000
}
```
A "Detection settings" popover lands on the run page next to the existing ppm input so users can tighten/relax without leaving the run.

The worker contract (`WorkerPeak`) gains: `r2: number`, `asymmetry: number`, `scale: number` so the table and tooltips can display the validation metrics.

### Auto-annotation

After picking, the worker (or a follow-up pass in `src/lib/lab.functions.ts`) matches each peak against the analyte library:

- Hard m/z gate: `|Δppm| ≤ method.mzToleranceUlPpm` (default 10).
- RT gate: `|Δrt| ≤ method.rtToleranceMin` (default 0.2 min), if the analyte has an expected RT on this method.
- Score: `confidence = 0.6 * exp(-(Δppm/ppmTol)^2) + 0.3 * exp(-(Δrt/rtTol)^2) + 0.1 * min(1, r2)`.
- Assign when `confidence ≥ 0.6` AND it's the best candidate for that peak; ties are broken by smaller Δppm.
- Anything below threshold stays `unannotated` but the top-3 candidates are stored on the peak so the existing "Suggested matches" panel shows them instantly.

This runs automatically after detection and on demand from a new "Re-annotate" button on the run header.

## 2. Peak-table visibility fix

Three small but real bugs in `src/routes/_shell.runs.$runId.tsx` + `src/components/peak-table.tsx`:

- After `addManualPeakFn` resolves, `addPeakLocal` appends to the store but the table is sorted by insertion order, so a peak at RT 4.2 lands at the bottom of page N. Sort `peaksForTable` by `rt` ascending and reset the table to page 1 + auto-select the new peak so the user always sees it.
- `usingDerivedPeaks` is `true` whenever `run.peaks.length === 0`. If detection runs and stores 0 picks (over-strict thresholds), the user sees only the library-derived ghost peaks and assumes nothing was detected. Replace the toggle with an explicit "Detected (N) / Library candidates (M)" tab so both lists are reachable and the empty state is honest.
- `PeakTable` paginates at 25 with no RT column sort; add column-header sort (RT, area, height, S/N, R²) and a quick "Annotated only / All" filter so RTs are findable in long lists.

Also: the table currently has no `key` for the "RT" header cell to anchor scroll-to; we'll add `data-peak-id` on each row and scroll the newly-saved/selected peak into view after `onSelect`.

## 3. Validation & references

- Algorithm: Tautenhahn R., Böttcher C., Neumann S. *Highly sensitive feature detection for high resolution LC/MS.* BMC Bioinformatics 9:504 (2008).
- Ridge detection: Du P., Kibbe W.A., Lin S.M. *Improved peak detection in mass spectrum by incorporating continuous wavelet transform-based pattern matching.* Bioinformatics 22(17):2059–2065 (2006).
- We add a small fixture set under `src/lib/__tests__/peak-picker.test.ts` (3 synthetic EICs: clean Gaussian, fronted peak, two overlapping peaks) and assert RT/area/R² are within tolerance. This is the "validated" claim — every change to the picker must keep these green.

## Files touched

- `src/workers/mzml.worker.ts` — call new picker, propagate new fields.
- `src/workers/peak-picker.ts` — **new**, CWT + ridge + validation.
- `src/workers/peak-picker.test.ts` — **new**, synthetic fixtures.
- `src/lib/lab-types.ts` — extend `Peak` with `r2`, `asymmetry`, `scale`, `candidates[]`.
- `src/lib/lab.functions.ts` — auto-annotation pass + persist new fields; add `reAnnotateRun` server fn.
- `src/lib/store.ts` — keep `peaks` sorted by RT on insert.
- `src/routes/_shell.runs.$runId.tsx` — detection settings popover, Detected/Library tabs, scroll-to-selected, Re-annotate button.
- `src/components/peak-table.tsx` — column sort, annotated-only filter, row anchors, R² column.
- Supabase migration: add columns `r2 numeric`, `asymmetry numeric`, `scale numeric`, `candidates jsonb` to `public.peaks` with safe defaults; no RLS change.

## Out of scope

- MS2 spectral-library matching (different problem, needs a spectral DB).
- Isotope/adduct grouping (worth doing next, but separate plan).
- Server-side re-processing of historical runs — we'll expose a "Re-detect" button per run; bulk re-detect is a follow-up.
