# Manual peak integration + Phase 3 wrap-up

Four work packages, shipped in order. Each is independently usable.

## 1. Manual peak integration on the EIC plot

Lets users drag on the EIC chart to set their own peak bounds when the
auto-picked peak is wrong (or missing entirely).

### UX

- The EIC card grows a small toolbar: **Auto / Integrate** toggle.
- In Integrate mode, the cursor turns into a crosshair. The user
  click-drags horizontally on the chart to set RT-start and RT-end.
- A shaded band overlays the chart between the two RTs, plus a dotted
  baseline drawn linearly from `(rtStart, y(rtStart))` to `(rtEnd, y(rtEnd))`.
- A live results strip under the chart shows: `RT_start`, `RT_end`,
  `apex RT`, `height`, `area (baseline-subtracted)`, `FWHM`, `S/N`.
- Buttons:
  - **Reset** — clears the manual region.
  - **Save as peak** — persists via `addManualPeak` (server fn below).
    For runs with no real `peaks` rows, the saved peak replaces the
    derived row in the bottom Peak Table and becomes annotatable.

### Math (client)

Given EIC arrays `x[], y[]` and `[rtStart, rtEnd]`:

1. Find inclusive index range `[il, ir]` covering the band.
2. Linear baseline `b(t) = y[il] + (y[ir]-y[il]) * (t - x[il])/(x[ir]-x[il])`.
3. `apex = max(y[i] - b(x[i]))` for `i in [il, ir]` → `height`,
   `apexRt = x[argmax]`.
4. `area = Σ ((y[i]-b(x[i])) + (y[i+1]-b(x[i+1])))/2 * (x[i+1]-x[i])`
   for `i in [il, ir-1]`, clamped to ≥0.
5. FWHM: walk left/right from apex while `(y - b) > apex/2`, return
   `xRight - xLeft`.
6. S/N: `apex / max(1, median(|y - b|) outside [il, ir])`.

### Server: `addManualPeak`

File: `src/lib/lab.functions.ts`.

```
addManualPeak({ runId, mz, mzLow?, mzHigh?, rt, rtStart, rtEnd,
                area, height, fwhm, sn, analyteId?, analyteName? })
  → { peak }
```

- `requireSupabaseAuth`. Verifies the run belongs to the current user
  via the existing run-ownership check (mirror of `deleteRun`).
- Inserts into `public.peaks` with the manual values plus
  `manual = true` (see migration below) and returns the new row mapped
  by `mapPeak`.

### Schema delta (migration)

```sql
alter table public.peaks add column if not exists manual boolean default false;
```

### Files touched

- `src/components/chromatogram-plot.tsx` — accept optional
  `selectionBand`, `baseline`, `onSelectRange` props; mouse handlers
  that translate pixel→time using Recharts' chart instance.
- `src/lib/peak-math.ts` — new pure helpers (`integrateBand`,
  `linearBaseline`, `fwhmAroundApex`).
- `src/lib/lab.functions.ts` — add `addManualPeak`.
- `src/lib/store.ts` — `addPeakLocal(runId, peak)`.
- `src/routes/_shell.runs.$runId.tsx` — toolbar, integration overlay,
  results strip, save handler.
- New migration adding `peaks.manual`.

---

## 2. Phase 3 — Real PDF report generation

The reports route still toasts a placeholder. Wire it up end-to-end.

### Approach

Render the PDF **client-side** with `jsPDF` + `html2canvas-pro`
(works with oklch tokens; the legacy html2canvas does not). The current
template's Worker SSR runtime can't run native PDF/canvas binaries, and
the existing `createReport` server fn already accepts a pre-uploaded
storage path — it just needs the actual file on the other end.

### Flow

1. User picks template (`run` / `batch` / `method`), subject(s),
   sections (method, chromatogram, peaks, notes), title.
2. Click **Generate PDF**:
   - Render the report markup into an off-screen container styled with
     the existing design tokens.
   - `html2canvas-pro` → page images, `jsPDF` `addImage` per page.
   - `jsPDF.output("blob")` → upload via `createUploadUrl({ bucket: "reports" })`
     using the returned `signedUrl`/`token`.
   - `createReport({ title, template, runIds, batchId?, storagePath })`.
3. Toast success + add the new report to a **Past reports** list on the
   same page (powered by `listReports`), each row with a
   **Download** button calling `getReportSignedUrl` and opening the URL.

### Files touched

- `src/lib/pdf-report.ts` — `renderReportPdf({ node, pageSize })`
  helper.
- `src/routes/_shell.reports.tsx` — replace placeholder with full flow,
  add Past Reports list.
- `package.json` — add `jspdf` and `html2canvas-pro`.

---

## 3. Phase 3 — Public share links

Already have `createShareLink`. Need a UI surface and a public route.

### UI

- On `/runs/$runId` and on the new Past Reports list, add a **Share**
  button. Opens a dialog:
  - Choose expiry (`24h / 7d / 30d / 1y`).
  - On confirm → `createShareLink({ resourceKind, resourceId, expiresInHours })`.
  - Display the resulting URL `${origin}/shared/${token}` with a
    **Copy** button.

### Public route

`src/routes/shared.$token.tsx` (no auth):

- Loader calls a new server fn `getSharedResource({ token })` that
  uses `supabaseAdmin` to:
  1. Fetch `shared_links` by token; reject if missing or
     `expires_at < now()`.
  2. Resolve the resource — for a `run`, return the same DTO shape
     the run-detail page reads (basic run + peaks + scans-blob signed URL
     for the TIC/EIC). For a `report`, return a 10-minute
     `getSignedUrl` to the PDF.
- Renders a **read-only** view: TIC, peak table, no annotation/delete
  controls. Reports route just embeds an `<iframe>` of the signed URL.

### Server route alternative

If the loader pattern is awkward for unauthenticated reads,
`src/routes/api/public/shared.$token.ts` exposes the same data as JSON
and the page consumes it via `fetch`. Pick the loader path; switch only
if the loader runs into auth-attacher issues.

### Files touched

- `src/lib/lab.functions.ts` — `getSharedResource` (uses `supabaseAdmin`,
  no auth middleware; expiry-checked).
- `src/components/share-dialog.tsx` — reusable dialog.
- `src/routes/shared.$token.tsx` — public viewer.
- `src/routes/_shell.runs.$runId.tsx` — Share button.
- `src/routes/_shell.reports.tsx` — Share button per report row.

---

## 4. Phase 3 — Audit log viewer (admin)

`audit_events` is populated by triggers; no UI yet.

### Server

- `listAuditEvents({ table?, action?, actorId?, since?, until?, limit })`
  in `src/lib/lab.functions.ts`. `requireSupabaseAuth` + admin-role
  check (mirror of `listAdminUsers`). Returns rows ordered by
  `created_at desc`, capped at 200.

### UI

`src/routes/_shell.admin.tsx` — add an **Audit log** tab next to the
existing user/role table:

- Filter row: table (select), action (insert/update/delete), actor
  (select from existing users list), date range.
- Table columns: timestamp, actor (email), table, action, row id,
  diff preview (collapsed JSON; click to expand).

### Files touched

- `src/lib/lab.functions.ts` — `listAuditEvents`.
- `src/routes/_shell.admin.tsx` — new tab + table.

---

## Out of scope

- Re-running raw peak picking server-side (separate task).
- Editing existing manual peaks (delete + re-add for now).
- Server-side PDF rendering (Worker runtime can't host a real renderer).
- Realtime audit-log streaming.
