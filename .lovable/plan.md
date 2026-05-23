
## 1. Upload says "Failed to fetch" but the run actually saves

What's happening: `processFile()` uploads the raw file + scans blob to Supabase Storage (those succeed — that's why you see the file after refresh), then calls the `createRun` server function with a JSON body that includes the full TIC/BPC trace (up to 20,000 points × 3 arrays) plus up to 2,000 peak rows. On large mzML files this body is several MB. The Cloudflare worker is finishing the insert server-side, but the client `fetch()` is dropping the response (the typical `TypeError: Failed to fetch`), so the UI shows the error toast even though the row is committed. Reloading then re-hydrates the run from the DB — exactly the symptom you described.

Fixes:
- **Shrink the createRun payload.** Move the trace into the scans blob (or a small `trace.json` uploaded to storage alongside it) and store only the storage path on the row. The DB already gets the trace via `summary_json.trace`; we'll switch to lazy-loading it from storage when the run detail page opens. Peaks stay inline.
- **Cap arrays before send.** Decimate the trace to ≤ 4,000 points (LTTB downsample) before persisting; full-resolution data stays in the scans blob for EIC work. No visible loss in the TIC plot.
- **Treat "fetch dropped after server success" as success.** Wrap the `createRunFn` call in a small helper that, on a network-style failure, re-queries `runs` by `file_path` and adopts the row if it already exists. No duplicate inserts, no false error toast.
- **Add retry + clearer error.** One automatic retry with exponential backoff before showing the toast; replace the generic "Failed to fetch" with "Network dropped — checking server…".

## 2. Peak detection is missing obvious analytes

Root cause: the worker only picks peaks on the **TIC**, then assigns each TIC peak whatever m/z happens to be the single strongest centroid in that scan. That means:
- Any analyte whose intensity is small relative to background or to co-eluting big peaks never shows up on the TIC and is silently dropped.
- Two co-eluting compounds collapse into one peak with one m/z.
- The hard cap of 60 TIC peaks throws away real signal on busy chromatograms.
- The 5×MAD/5×noise threshold in `centroidAndThreshold` and `pickPeaks` is aggressive enough to wipe out medium‑abundance ions.

New detection pipeline in `src/workers/mzml.worker.ts`:

1. **Build mass traces (XICs), not just TIC.**
   After centroiding each scan, cluster centroids across scans into mass traces using a ±10 ppm m/z tolerance and a max gap of 3 scans (ADAP/XCMS‑style "chromatographic peak detection"). Each trace = a list of (rt, intensity) for one m/z.
2. **Detect peaks per trace.** For every trace with ≥ 5 scans, run a Gaussian‑shape peak picker:
   - local‑maximum search with smoothed (Savitzky–Golay length 5) signal,
   - baseline = 20th percentile of the trace,
   - noise = MAD of the lower half of the trace,
   - keep peaks with S/N ≥ 3 (down from 5) and FWHM in 0.02–2.0 min,
   - compute area by trapezoid, height, FWHM, S/N, apex m/z (intensity‑weighted mean of the centroids inside the peak).
3. **Merge near-duplicates.** Collapse peaks within ±5 ppm m/z AND ≤ 0.05 min rt into the strongest representative.
4. **Rank and cap.** Sort by area, keep up to **500** peaks (was 60). Configurable.
5. **Keep TIC/BPC trace** as before for plotting.
6. **Lower the centroid threshold** from baseline + 5·MAD to baseline + 3·MAD so weaker isotopes/adducts survive.
7. **Budget guard stays** but is raised — we already store the scans blob, so we can afford up to ~12M kept points before truncating.

UI changes (small):
- Peak table gets a "min S/N" and "min height" filter so users can dial sensitivity without re-uploading. Defaults match the worker output (S/N ≥ 3).
- A "Re-detect peaks" button on the run page re-runs detection client-side from the stored scans blob using the user's chosen thresholds and persists via a new `replaceRunPeaks` server fn.

## Files to change

- `src/workers/mzml.worker.ts` — new mass-trace + peak picker, lower thresholds, raised caps.
- `src/lib/peak-math.ts` — extract the Savitzky–Golay + per-trace picker so the run page can reuse it.
- `src/routes/_shell.runs.index.tsx` — slim createRun payload, network-drop recovery, retry, decimated trace.
- `src/lib/lab.functions.ts` — accept optional `tracePath` (uploaded JSON), add `replaceRunPeaks`, relax `peaks.max` to 1000, drop the inline `trace` requirement (fallback path kept for old runs).
- `src/lib/lab-data.server.ts` — on load, if `summary_json.tracePath` is present, fetch trace from storage instead of inlined `trace`.
- `src/routes/_shell.runs.$runId.tsx` — sensitivity sliders + "Re-detect peaks" action.

## Out of scope

- No schema migration required; we reuse `summary_json` for `tracePath` and keep peaks in the existing `peaks` table.
- No change to EIC extraction (`src/lib/eic.ts`) — it already operates on the full-resolution scans blob and will benefit immediately from the better peak m/z assignments.
