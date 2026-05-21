-- CHROMA.LAB — Phase 3c delta
-- Adds apex m/z and analyte_name columns on peaks.
-- mz: companion to mz_low / mz_high added in phase 3, set by the mzML/mzXML worker
--     so EIC + analyte matching can use the picked peak's apex m/z directly.
-- analyte_name: free-text label written when a user manually integrates / labels a peak
--     without binding it to a row in the analytes library.
--
-- Run AFTER chroma_lab_phase3b_migration.sql.

alter table public.peaks add column if not exists mz           double precision;
alter table public.peaks add column if not exists analyte_name text;

-- Reports table: backfill columns from the Phase 3 migration in case it was
-- only partially applied (older deployments are missing batch_id / run_ids).
alter table public.reports add column if not exists batch_id     uuid references public.batches(id) on delete set null;
alter table public.reports add column if not exists run_ids      uuid[] not null default '{}';
alter table public.reports add column if not exists template     text;
alter table public.reports add column if not exists storage_path text;
