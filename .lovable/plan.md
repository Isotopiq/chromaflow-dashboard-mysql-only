## Goal
Allow users to delete runs and batches they own.

## Server functions (`src/lib/lab.functions.ts`)
- `deleteRun({ runId })` — auth-protected. Verifies the run belongs to `userId` (or user is admin), removes the storage objects (`file_path`, `scans_blob_path` from `raw-runs` bucket, ignoring missing-file errors), then deletes the row in `runs`. Cascading FK deletes child `peaks` / `annotations`.
- `deleteBatch({ batchId, deleteRuns })` — auth-protected. If `deleteRuns` is true, fetches all runs in the batch and deletes them via the same path; otherwise nullifies `runs.batch_id` and removes the batch row.

## Store (`src/lib/store.ts`)
- Add `removeRunLocal(id)` and `removeBatchLocal(id)` actions.

## UI

### Runs list (`/runs`)
- Add a trash icon per row → opens an `AlertDialog` (shadcn) confirming the run name.
- On confirm: call `deleteRun`, `removeRunLocal`, `toast.success`.

### Run detail (`/runs/$runId`)
- Add a "Delete run" `Button` (destructive, outline) in the top-right action bar next to "Peaks CSV". Same confirm dialog. On success → navigate back to `/runs`.

### Batches list (`/batches`)
- Add a trash icon per batch row → confirm dialog with a checkbox: "Also delete the N runs in this batch". Calls `deleteBatch` with `deleteRuns` flag.

## Files touched
- edit `src/lib/lab.functions.ts` (add 2 server fns)
- edit `src/lib/store.ts` (add 2 local removers)
- edit `src/routes/_shell.runs.index.tsx` (row delete)
- edit `src/routes/_shell.runs.$runId.tsx` (header delete button)
- edit `src/routes/_shell.batches.tsx` (row delete with cascade option)

## Out of scope
- Soft-delete / undo
- Bulk multi-select delete (can add later if needed)
- Permission UI changes (admins implicitly can delete anything via the same fn)