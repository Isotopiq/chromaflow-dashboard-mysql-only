## 1. Analyte detail page — show XICs for all runs

The analyte page (`src/routes/_shell.analytes.$analyteId.tsx`) already renders the shared `AnalyteComparePanel`, but that component caps overlays at **6 runs** (`MAX_RUNS = 6`, one per column/method group) so most runs never appear.

Changes:
- Build a dedicated section on the analyte page that lists **every run in the project** and renders an EIC chromatogram for the analyte's m/z on each one (grouped under a "Saved XIC chromatograms" header).
  - One small `ChromatogramPlot` card per run (compact mode), sorted newest first.
  - Each card shows: run name, acquired date, column + method badges, integrated area in the analyte's RT window, and a link to the run detail page.
  - Reuse `getRunEIC` (already used by the compare panel) via `useQueries` so all EIC fetches happen in parallel and are cached.
  - Use the analyte's `mz` (or formula-derived [M+H]⁺) with a configurable ppm tolerance (default 10 ppm) and RT window centered on `rtExpected`.
- Keep the existing `AnalyteComparePanel` block above as the side-by-side overlay (capped at 6) for quick comparison, and add the full grid below it.
- Empty/loading states: skeleton card while EIC is loading, "No signal in this run" when the trace is flat below threshold.

No backend changes required — `getRunEIC` already returns per-run extracted ion chromatograms.

## 2. Persistent peak annotations on the run detail page

Annotations **are already persisted server-side** — `useAnnotatePeak` (in `src/lib/store.ts`) calls the `annotatePeak` server function which writes to `public.peaks.analyte_id` / `analyte_name`, and the run detail page already invokes it. So annotations should survive navigation.

If they currently appear to reset, the likely causes are:
- The store's `runs` array is replaced on every bootstrap fetch — local optimistic updates can be overwritten if a refetch lands before the server write completes, or if the server write silently failed.
- Manually-added peaks (via `addPeakLocal`) are local-only until the user re-uploads.

Changes:
- Verify `annotatePeak` server fn returns the updated peak row and update the store with the server response (replace the optimistic-only update with server-confirmed data).
- Surface server errors via `toast.error` so silent failures become visible.
- Add an explicit "Save annotations" affordance is not needed — annotations save on assign — but add a small "Saved" / "Saving…" indicator next to each annotated peak so the user can see the write succeeded.
- For manually-added peaks (`addPeakLocal`): when the user annotates one, also persist the peak itself via the existing `addPeak` server fn (currently only the annotation call runs, which fails for peaks that don't exist in the DB yet).

## 3. Columns 404 — diagnostic

The route file `_shell.columns.$columnId.tsx` is correct (slash path, hydration gate, `useParams`). The list page links via `<Link to="/columns/$columnId" params={{ columnId: c.id }}>` (verified earlier). So a persisting 404 most likely means **the column row isn't being returned by the bootstrap query for your user** — RLS filtering or a missing row.

I'll add a temporary diagnostic banner on the column not-found state that shows:
- The `columnId` from the URL.
- Whether the store is hydrated.
- How many columns the bootstrap returned.
- The first few column IDs (so you can see if the URL id matches anything).

This will tell us in one screenshot whether it's an RLS issue (zero columns returned), an ID mismatch (different format), or a stale store. Based on that result we'll know whether a SQL fix is needed.

**SQL queries you can run now to help confirm** (paste output back):

```sql
-- 1. Do any columns exist for your user?
select id, name, owner_id, created_at
from public.columns
order by created_at desc
limit 20;

-- 2. Check RLS policies on columns
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'columns';

-- 3. Check grants
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'columns';
```

If query 1 returns rows but the app shows 0, it's an RLS / `app.user_id` GUC mismatch in `withDb`. If query 3 is missing `SELECT` for `authenticated`, that's a grant migration we'll add.

## Files to edit

- `src/routes/_shell.analytes.$analyteId.tsx` — add "Saved XIC chromatograms" grid for all runs.
- `src/routes/_shell.runs.$runId.tsx` — persist manually-added peaks before annotating; show save status; surface errors.
- `src/lib/store.ts` — make `useAnnotatePeak` apply the server response (not just optimistic local).
- `src/routes/_shell.columns.$columnId.tsx` — add a temporary diagnostic block on the not-found state.

## Open question

Should the analyte detail XIC grid show **every run in the project**, or only runs whose method/column is compatible with the analyte (e.g. same ionization mode)? Showing all runs is simpler and matches your request literally; filtering is cleaner but hides data. Default plan: show all, with badges that make the column/method obvious.
