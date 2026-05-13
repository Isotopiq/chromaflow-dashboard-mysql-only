# Plan — Phase 2 finish + Phase 3, with EIC support

User-driven addition: when a user clicks a peak on a run, they must see the **Extracted Ion Chromatogram (EIC)** for that peak's m/z, not just TIC/BPC. mzML/mzXML files can contain dozens of overlapping peaks — EIC is essential to disambiguate co-eluting metabolites.

---

## Phase 2 — remaining work

### 1. mzML worker → richer RunSummary (EIC-ready)
Extend `src/workers/mzml.worker.ts` so the posted summary carries per-scan m/z arrays, not just trace + peak list:

```
RunSummary {
  trace:  { x:number[], tic:number[], bpc:number[] }
  scans:  { rt:number, mz:Float32Array, intensity:Float32Array }[]   // centroided
  peaks:  { rt, area, height, fwhm, sn, mz, mzWindow:[lo,hi] }[]
  ionMode, format, msLevel
}
```

- Add a centroid pass per MS1 scan; drop noise below `5 × baselineMAD`.
- Compute each detected peak's apex m/z and a ±10 ppm window stored on the peak row.
- Memory cap: if total scan points > 5M, downsample by RT binning and warn in the summary (`truncated:true`).

### 2. EIC extractor (client + server)
- **Client helper** `src/lib/eic.ts`: `extractEIC(scans, mz, ppm=10) → { x:number[], y:number[] }`. Used immediately after parse so the user sees an EIC without a round-trip.
- **Server fn** `getRunEIC({ runId, mz, ppm })` in `src/lib/runs.functions.ts`: rebuilds the EIC from persisted scan data when the user re-opens a saved run. Backed by a new `run_scans` table (see schema delta below) or a `scans.parquet` blob in the `raw-runs` bucket — pick parquet to avoid bloating Postgres.

### 3. Schema delta (one extra migration to run)
```sql
alter table peaks add column mz_low double precision;
alter table peaks add column mz_high double precision;
alter table runs add column scans_blob_path text;   -- key in raw-runs bucket
alter table runs add column ms_level smallint default 1;
```
No new tables; scans live as a compressed binary blob alongside the raw file.

### 4. Upload pipeline (`/runs` page)
1. Drag-and-drop file → worker parses → returns `RunSummary` + `scansBlob (Uint8Array, gzipped Float32 pairs)`.
2. Client requests two signed upload URLs from `getRunUploadUrls` server fn (raw + scans).
3. Client PUTs both blobs directly to Storage.
4. Client calls `createRunFromUpload({ summary, rawPath, scansPath, methodId, columnId, batchId? })` which writes `runs` + `peaks` rows.
5. Toast + redirect to `/runs/$runId`.

### 5. Run detail page — EIC UI
Rebuild `src/routes/_shell.runs.$runId.tsx` (now `_authenticated/_shell.runs.$runId.tsx`):
- Top chart: TIC + BPC overlay (toggleable).
- **Bottom chart: EIC for the selected peak** — shown automatically when a peak row is clicked, m/z + ppm window displayed in the header, ppm slider (5/10/20/50).
- "Add custom EIC" input: user types m/z, gets an EIC trace overlay (color-coded). Stored in component state, not persisted unless they hit "Save annotation".
- Peak table column: `m/z (± ppm)` is now clickable → triggers EIC.
- Suggested analytes panel: filter by `|rtExpected − peak.rt| < 0.3 min` AND `|monoisotopic − peak.mz| < 10 ppm`.

### 6. Phase-2 cleanup still owed from prior turn
- Replace remaining `useLab()` reads on `/runs`, `/reports`, `/admin` with `useServerFn` + `useQuery`.
- Move all `_shell.*` route files under `_authenticated/` so loaders are guard-safe.
- Delete `src/lib/mock-data.ts` imports from production code (keep file for the seed script only).

---

## Phase 3

### A. PDF reports (`/reports`)
- New server fn `generateReport({ runIds, templateId })` builds JSON payload, returns `reportId`.
- Client renders to PDF with `@react-pdf/renderer` (Worker-safe, pure JS) — runs in browser, uploads PDF to `reports` bucket, writes `reports` row.
- Templates: "Single run summary", "Batch comparison", "Method validation".
- Each report page: method header, column header, TIC, peak table, per-peak EIC thumbnail, annotations.

### B. CSV / Excel exports
- Add `Download ▾` menu on `/runs/$runId`, `/analytes`, `/batches/$id`:
  - Peaks CSV, Peaks XLSX (`xlsx` lib), EIC CSV for selected peak, full scan table (gz).
- Server fn `exportBatchPeaks(batchId)` streams a single CSV across all runs.

### C. Automated batch annotation matching
- Server fn `autoAnnotateBatch(batchId)`: for each run, for each peak, find best analyte by combined score `w1·rtΔ + w2·mzPpmΔ`, write `annotations` row when score < threshold. Returns counts.
- UI button on batch detail; shows progress + diff before commit.

### D. Sharing links
- `shared_links` table: `id, run_id|report_id, token, expires_at, created_by`.
- Server fns: `createShareLink`, `revokeShareLink`.
- Public route `/share/$token` (under `api/public/` for the loader fetch) renders a read-only run/report view; no auth.

### E. Admin niceties
- Audit log table `audit_events` + trigger on `runs`, `methods`, `annotations`.
- `/admin/audit` page with filter by user/date/table.

---

## Order of execution
1. Worker EIC upgrade + schema delta migration (I'll hand you the SQL).
2. Upload pipeline + run detail EIC UI.
3. Finish migrating remaining pages off Zustand into `_authenticated/`.
4. Phase 3 A → B → C → D → E in that order.

I'll pause once after step 1 for you to run the schema-delta SQL, then run straight through.

## Tech notes
- All chromatogram math (EIC extraction, centroiding) stays in the browser worker — keeps the Cloudflare Worker SSR runtime free of binary deps.
- `@react-pdf/renderer` is Worker-incompatible for SSR but fine in the browser; PDFs are generated client-side, uploaded as blobs.
- Scans blob format: gzipped concatenation of `[rt:f32][n:u32][mz:f32×n][int:f32×n]` per scan — small, fast to slice for EIC rebuilds.

## What I need from you
- Run the schema-delta SQL I'll send after you approve.
- Nothing else; secrets and base schema are already in place.
