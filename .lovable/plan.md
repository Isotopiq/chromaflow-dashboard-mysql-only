## Why clicking a batch does nothing

There is no `src/routes/_shell.batches.$batchId.tsx`. The card has no link target, so clicks are silent. Every other module (runs, methods, columns, analytes) has a `$id.tsx` detail file — batches is the only one missing it.

## What I'll build

### 1. Batch detail page — `src/routes/_shell.batches.$batchId.tsx`

Mirrors `_shell.methods.$methodId.tsx`:

- Header: name, project, owner, status pill, created date, back link.
- Inline-editable **name**, **project**, **status** (in_progress / review / complete), autosaved via extended `upsertBatch`.
- Stat cards: runs count, total peaks, annotated peaks, % annotated, unique methods, unique columns.
- **Runs table**: name, method, column, peaks count, annotated count, link to run, per-row "Remove from batch" + "Add runs…" combobox of the user's currently-unassigned runs.
- **Auto-annotate panel**: ppm + RT-tol inputs, "Auto-annotate all peaks in batch" button → existing `autoAnnotateBatch`.
- **Batch notes** textarea (debounced 600 ms autosave + "Saved · Ns ago" indicator).
- **Export**: combined peaks CSV across all runs in the batch.
- Delete batch (with cascade option) — reuses existing `deleteBatch`.

### 2. Make batch cards clickable

`BatchCard` in `_shell.batches.tsx` becomes a `<Link to="/batches/$batchId">` wrapper; trash button + delete dialog `stopPropagation` so deletion still works in place.

### 3. "Save anywhere" persistence pass

Every annotation / peak-picking action and freeform note round-trips to the DB so users can leave and resume.

Already persistent (verified): `annotatePeak`, `addManualPeak` (incl. Accept-checkbox path), `unassignPeaks`, `createRun` auto-annotation, `upsertBatch`, `deleteBatch`.

New persistence:
- **Free-text notes** on `peaks`, `runs`, `batches` (new `notes` columns, default `''`).
- New server fns (all `requireAuth`, owner-scoped):
  - `updatePeakNotes({ runId, peakId, notes })`
  - `updateRunNotes({ runId, notes })`
  - `updateBatchNotes({ batchId, notes })`
  - `setRunBatch({ runId, batchId | null })` for add/remove from the batch page.
  - Extend `upsertBatch` input with optional `status` + `notes`, piped into the UPDATE.
- Store actions: `updateBatchLocal`, `updatePeakNotesLocal`, `updateRunNotesLocal`, `setRunBatchLocal`.
- New `<SaveStatus state lastSaved />` component, used on:
  - Run detail page (annotation/integration toolbar)
  - Batch detail page (header)
  - Peak side-panel (notes field)

### 4. Schema migration (user must run)

```sql
alter table public.batches add column if not exists notes  text not null default '';
alter table public.batches add column if not exists status text not null default 'in_progress';
alter table public.runs    add column if not exists notes  text not null default '';
alter table public.peaks   add column if not exists notes  text not null default '';
```

No new tables, no new RLS — existing owner-scoped policies already cover the new columns. `mapBatch` / `mapRun` / `mapPeak` extended to read them.

### 5. Files touched / created

- **new** `src/routes/_shell.batches.$batchId.tsx`
- **new** `src/components/save-status.tsx`
- `src/routes/_shell.batches.tsx` — wrap card in Link, stop-propagate destructive controls
- `src/routes/_shell.runs.$runId.tsx` — add Notes field (peak + run), wire save indicator
- `src/lib/lab.functions.ts` — new server fns + extended `upsertBatch`
- `src/lib/lab-types.ts` — `notes` on Batch / Run / Peak
- `src/lib/lab-data.server.ts` — map new columns
- `src/lib/store.ts` — new local mutators

### Out of scope

- Bulk peak re-detection from the batch page (still per-run).
- Multi-user real-time collaboration on the same peak (last-write-wins for notes).
- Sample-sheet ingestion / per-sample metadata schema.

### After I'm done

You will need to run the SQL block in section 4 once via the migration tool (Cloud → SQL editor). The app will function the moment that migration is applied — no data backfill required.