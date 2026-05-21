-- CHROMA.LAB — Phase 3c delta
-- Adds apex m/z column on peaks (companion to mz_low / mz_high added in phase 3).
-- The mzML/mzXML worker writes each picked peak's apex m/z here so EIC + analyte
-- matching can use it directly.
--
-- Run AFTER chroma_lab_phase3b_migration.sql.

alter table public.peaks add column if not exists mz double precision;
