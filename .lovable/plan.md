## Goals

Three small fixes + one new view, then close out Phase 3.

1. Make Add / Edit / Delete buttons on `/analytes` reliably work.
2. Make the Generate-PDF button on `/reports` actually produce + save a PDF.
3. Make analyte rows on `/analytes` clickable → new `/analytes/$analyteId` page that shows that compound across every column it's been recorded on.

## 1. Analyte add / edit / delete

Backend functions (`addAnalyte`, `updateAnalyte`, `deleteAnalyte`) and the dialog wiring already exist. The most likely failure modes seen in this kind of setup are:

- The Add / Edit dialog Save button is disabled because `mzPos` is `null` (no formula entered) and no manual m/z is provided — the form silently looks "broken" because the only failure cue is a greyed button.
- Toast errors from the server fn never reach the user because the `addLocal` call only runs on success and the surrounding `try/catch` is missing on the create path (only delete has it).
- After a server-fn error, the dialog stays open with no feedback.

Fix in `src/routes/_shell.analytes.tsx`:

- Wrap the `onSubmit` in `CompoundFormDialog` invocations (both create and edit) so any thrown error from `addFn` / `updateFn` shows a `toast.error(...)` instead of being swallowed; keep the dialog open on failure.
- Show an inline hint under the Save button when it is disabled, explaining which field is missing (name / RT / formula-or-mz).
- Add `e.preventDefault()` guards inside dialog Save to ensure the click never bubbles into a parent route navigation.
- Verify the Delete `AlertDialogAction` actually closes the dialog after success (it currently relies on default behavior; explicitly call the trigger's close so the row visibly updates).

No schema or server-fn changes.

## 2. PDF report button

The PDF flow (`renderReportPdf` → `createUploadUrl` → PUT to signed URL → `createReport`) is wired but fails silently in two common cases:

- `html2canvas-pro` throws on any element with computed `display: none` or zero size (the Past-reports card or sidebar). Right now `printRef` wraps a card with a chromatogram — if no `methodRun` exists for the selected method, the canvas is empty and jsPDF rejects with `Invalid coordinates`.
- The `reports` storage bucket may not exist in the project; `createSignedUploadUrl` then 404s and the caller only sees a generic toast.

Fix in `src/routes/_shell.reports.tsx` and `src/lib/pdf-report.ts`:

- Disable the Generate button (with a tooltip) when there is no `method` OR no `methodRun`, so users get an explicit reason instead of a silent failure.
- In `renderReportPdf`, guard against zero-size canvases (return a friendly Error). Bubble the error message into the Reports page toast.
- In the Generate handler, if the `PUT` to the signed URL fails, surface the actual response text in the toast (currently only status code).
- Add a one-time check: on first Generate, if `createUploadUrl` errors with "Bucket not found", show a clear "Reports storage bucket missing — re-run Phase 3 migration" toast.

If the bucket is genuinely missing, I'll add a small idempotent SQL snippet to `chroma_lab_phase3b_migration.sql` (or a new `chroma_lab_phase3c_migration.sql`) that creates the `reports` bucket and the matching storage RLS — only as a copy/run snippet, not auto-applied.

## 3. Click analyte → cross-column view

New route: `src/routes/_shell.analytes.$analyteId.tsx`

The `analyte-compare-panel.tsx` component already does most of the work (EIC overlay + per-run metrics + group summaries). The new page reuses it with these defaults:

- `analyteId` locked to the route param (no picker).
- `groupBy` defaults to `column`.
- Auto-selects up to 6 runs: for every column that has at least one run with a peak matching this analyte (by `analyteId` or `analyteName`), pick the most recent qualifying run. Falls back to most-recent runs overall if no annotated peaks exist.
- Header: analyte name + formula + [M+H]⁺, "Seen on N columns across M runs" summary.
- Empty state when the compound has never been recorded on any column.

Wire-up in `src/routes/_shell.analytes.tsx`:

- Wrap each row's name cell in a `<Link to="/analytes/$analyteId" params={{ analyteId: a.id }}>` (keeps Edit/Delete buttons unaffected via `e.stopPropagation()`).
- Add a "View across columns" item near the row actions for discoverability.

Small refactor in `analyte-compare-panel.tsx`: accept optional props `lockedAnalyteId`, `defaultGroupBy`, `hideAnalytePicker` so the new route can reuse it without duplicating logic.

## Phase 3 status

After these three fixes, Phase 3 (PDF reports, public share links, admin audit log, method/analyte comparison) is **complete**. No further Phase 3 items remain on the plan.

## Files

- Edit `src/routes/_shell.analytes.tsx` — error handling, disabled-button hint, row link.
- Edit `src/routes/_shell.reports.tsx` — better error messages, disable when no run.
- Edit `src/lib/pdf-report.ts` — guard empty canvas, surface readable errors.
- Edit `src/components/analyte-compare-panel.tsx` — accept locked-analyte props.
- New `src/routes/_shell.analytes.$analyteId.tsx` — cross-column analyte page.
- (Optional) New `chroma_lab_phase3c_migration.sql` — only if `reports` bucket is missing.

## Out of scope

- No new server functions, no schema changes (except the optional bucket-only SQL snippet).
- No changes to auth, RLS, or the existing PDF layout.
