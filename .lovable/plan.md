## Goal

Today `/methods/compare` only diffs parameters of two methods and overlays their TIC. Users can't yet answer the question: *"How does Caffeine look on the BEH C18 vs HSS T3 column, or with Method A vs Method B?"* This plan adds that capability.

## What gets built

A new tab on the Compare page (and a sibling route) that lets the user:

1. Pick one **analyte** from the library (defines target m/z + expected RT).
2. Pick a **grouping axis**: by **column** or by **method**.
3. Pick **2–6 runs** to overlay (auto-suggested: most recent run per column/method).
4. See, side by side:
   - **EIC overlay** of the analyte's m/z across the chosen runs (color-coded per group).
   - **Per-run metrics table**: column, method, RT (observed), Δ vs expected, peak height, area, FWHM, S/N, asymmetry estimate.
   - **Group summary chips**: mean RT, RT spread, mean area per column/method group.
   - **Parameter strip**: small chips per run summarizing the differing method parameters (gradient %B at peak RT, flow, temp, mobile phase) so visual differences map back to conditions.

## UX

```text
/methods/compare
┌─ Tabs ─────────────────────────────────────────────┐
│ [Method diff]  [Analyte across runs]               │
└────────────────────────────────────────────────────┘

Analyte across runs:
  Analyte: [Caffeine ▾]    Group by: (Column ◉ / Method ○)   ppm: [10]
  Runs (max 6):
    ☑ run-2025-11-12 · BEH C18 · Method A
    ☑ run-2025-11-09 · HSS T3  · Method B
    ☑ run-2025-10-30 · BEH C18 · Method A-v2
    ...

  ┌── EIC overlay (m/z 195.0877 ±10 ppm) ────────────┐
  │  multi-line plot, legend grouped by column       │
  └──────────────────────────────────────────────────┘

  Table:
    Run | Column | Method | RT | ΔRT | Height | Area | FWHM | S/N
    ... per row, sortable

  Group summary:
    BEH C18 (n=2): RT 3.41 ± 0.02, area 1.2e7
    HSS T3 (n=1):  RT 3.78,        area 9.4e6
```

## Implementation

### Files

- **New**: `src/routes/_shell.methods.compare.analyte.tsx` — new route at `/methods/compare/analyte`.
- **Edit**: `src/routes/_shell.methods.compare.tsx` — convert current single view into a Tabs container with two tabs (Method diff = existing content; Analyte across runs = new component). Keep existing functionality unchanged inside its tab.
- **New**: `src/components/analyte-compare-panel.tsx` — the picker + plot + table component (reused by the route and the tab so it can also be embedded standalone).
- **Edit (small)**: `src/components/app-sidebar.tsx` — add a sub-link "Analyte compare" under Methods (only if a Methods group exists; otherwise skip).

### Data flow

- Read `analytes`, `runs`, `columns`, `methods` from `useLab()` store (already populated).
- For each selected run:
  - If `run.scansBlobPath` exists → call existing `getRunEIC` server fn (parallel `useQueries`) for the analyte m/z + ppm.
  - If no scans blob (mock/synthetic runs) → fall back to the run's TIC trace and use `peaks` matched by `analyteId`/`analyteName` for the metrics row, so the page still works on seed data.
- Compute metrics client-side via `integrateBand` from `src/lib/peak-math.ts` over a window around the EIC apex (apex ± 3·FWHM, fallback to ±0.5 min around expected RT).
- No new server functions, no schema changes.

### Component sketch

```tsx
// AnalyteComparePanel
const { analytes, runs, columns, methods } = useLab();
const [analyteId, setAnalyteId] = useState(analytes[0]?.id);
const [groupBy, setGroupBy] = useState<"column" | "method">("column");
const [runIds, setRunIds] = useState<string[]>(/* auto: 1 most-recent run per group */);
const [ppm, setPpm] = useState(10);

const fetchEIC = useServerFn(getRunEIC);
const queries = useQueries({
  queries: runIds.map((id) => {
    const run = runs.find(r => r.id === id)!;
    return {
      queryKey: ["analyte-eic", id, analyte.mz, ppm],
      queryFn: () => run.scansBlobPath
        ? fetchEIC({ data: { runId: id, mz: analyte.mz, ppm } })
        : Promise.resolve({ x: run.trace.x, y: run.trace.tic, mz: analyte.mz, ppm, mzLow: 0, mzHigh: 0 }),
    };
  }),
});

// Build ChromatogramPlot runs: one entry per selected run, color via groupKey.
// Build table rows by integrating each trace around its apex.
```

### Reused primitives

- `ChromatogramPlot` (already supports per-run x/y).
- `Table`, `Card`, `Select`, `Checkbox`, `Badge` from `src/components/ui/*`.
- `integrateBand` from `src/lib/peak-math.ts`.
- `getRunEIC` server function — no changes.

### Edge cases

- 0 runs selected → empty state with hint.
- Run with no scans blob and no annotated peak for the analyte → row shows "—" metrics with a "no EIC data" note; trace still plotted from TIC.
- Different x-axis ranges across runs → `ChromatogramPlot` already supports this.
- Same color collisions across groups → assign color per group (column or method), with line dash style varying per run inside the group.

## Out of scope

- No new persistence, no new RLS, no new migrations.
- No PDF export of this view in this pass (can be added later via existing `pdf-report` capture flow).
- No editing of analytes from this page.

## Acceptance

- From `/methods/compare`, switch to "Analyte across runs", pick Caffeine, group by Column, pick 3 runs across 2 columns → overlay renders and table shows RT/area/FWHM per run + group summary.
- Works on seed data (no scans blob) by falling back to TIC + annotated peaks.
- No regressions to the existing Method diff tab.
