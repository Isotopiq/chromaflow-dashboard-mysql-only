-- CHROMA.LAB — Phase 5 schema delta
-- Adds avatar_url to profiles + an "avatars" public storage bucket
-- so users can upload their own profile picture.
-- Run AFTER chroma_lab_phase4_migration.sql.

-- ====================================================================
-- 1. profiles.avatar_url
-- ====================================================================
alter table public.profiles
  add column if not exists avatar_url text;

-- ====================================================================
-- 2. avatars storage bucket (public read; per-user write)
-- ====================================================================
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists "avatars: read all" on storage.objects;
create policy "avatars: read all"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Object key convention: `<auth.uid()>/<filename>`. Users can only write
-- inside their own folder.
drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
