# Finish the Column Library

The backend already supports columns: `upsertColumn` server fn (with full Zod schema for name, chemistry, dimensions, particle size, serial, rated/used injections, status, notes), `mapColumn` row mapper, and `upsertColumnLocal` in the Zustand store. The UI is the only missing piece — the "Add column" button on `/columns` does nothing today, and the detail page has no Edit affordance.

## What to build

### 1. Reusable column form dialog

New component `src/components/column-form-dialog.tsx`:

- Controlled `Dialog` with fields: Name, Manufacturer, Chemistry, Dimensions (e.g. `2.1 x 100 mm`), Particle size (e.g. `1.7 µm`), Serial #, Rated injections, Used injections, Status (`healthy` / `warn` / `expired`), Notes.
- Client-side validation matching the server Zod schema; disable Save with an inline hint when required fields are missing.
- Single `onSubmit(values)` prop — parent owns the server call.
- Works in both "create" and "edit" mode via an optional `initial` prop.

### 2. Wire "Add column" on the list page

Edit `src/routes/_shell.columns.index.tsx`:

- Replace the dead `<Button>Add column</Button>` with a trigger that opens `ColumnFormDialog`.
- On submit, call `upsertColumn` via `useServerFn`, then `upsertColumnLocal(saved)` so the new card appears immediately without a refetch.
- `try/catch` with `toast.error(...)` on failure; `toast.success` + close on success.
- Empty state: when `columns.length === 0`, show a friendly card with a CTA that opens the same dialog.

### 3. Edit + maintenance actions on the detail page

Edit `src/routes/_shell.columns.$columnId.tsx`:

- Add an "Edit column" button in the header (next to the status badge) that opens `ColumnFormDialog` pre-filled with the current column.
- Wire the existing "Log maintenance event" button to a small inline popover that lets the user bump `usedInjections` by N and/or change `status` — same `upsertColumn` path, appends a note line to `notes_md` like `2026-05-16 · +50 inj, status → warn`.
- Add a "Delete column" action behind an `AlertDialog` confirm. Uses a new server fn (see Technical) and only enabled when no methods/runs reference the column; otherwise show the count and disable.

### 4. Server: deletion safety

Add `deleteColumn` to `src/lib/lab.functions.ts`:

- Auth-protected; loads the column, ensures it's owned by the user (or user is admin), refuses if any `methods.column_id` or `runs.column_id` still references it.
- Returns `{ ok: true }` so the client can `setColumns(s => s.filter(...))`.

No schema changes needed — the `columns` table and RLS already exist from earlier phases.

## Technical notes

- Reuse `toast` from `sonner`, `Dialog`/`AlertDialog`/`Input`/`Select` from `@/components/ui/*`, matching the patterns in `src/routes/_shell.analytes.tsx`.
- Store integration: `useLab().upsertColumnLocal(saved)` already handles both insert and update, so the same call works for create and edit.
- `pressureTrend` is read-only telemetry — not in the form. New columns start with `[]` (the mapper already defaults to that).
- Keep all changes in frontend + the one new server fn; no migrations.

## Files

- New `src/components/column-form-dialog.tsx`
- New `deleteColumn` export in `src/lib/lab.functions.ts`
- Edit `src/routes/_shell.columns.index.tsx` — Add-column wiring + empty state
- Edit `src/routes/_shell.columns.$columnId.tsx` — Edit, maintenance, delete

## Out of scope

- Auto-derived pressure trend from new runs (already handled where runs are ingested).
- Bulk import / CSV upload for columns.
- Changes to method or run pages beyond what they already render.
