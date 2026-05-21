-- CHROMA.LAB — Phase 4 schema delta
-- Adds branding (favicon / web logo / pdf logo) + invite-code registration.
-- Run this in the Supabase SQL editor AFTER chroma_lab_phase3*.sql.

-- ====================================================================
-- 1. Branding settings (singleton row id = 1)
-- ====================================================================
create table if not exists public.branding_settings (
  id            int primary key default 1,
  favicon_path  text,
  web_logo_path text,
  pdf_logo_path text,
  app_name      text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  constraint branding_singleton check (id = 1)
);

insert into public.branding_settings (id) values (1) on conflict (id) do nothing;

alter table public.branding_settings enable row level security;

drop policy if exists "branding: read all" on public.branding_settings;
create policy "branding: read all"
  on public.branding_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "branding: admin write" on public.branding_settings;
create policy "branding: admin write"
  on public.branding_settings for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ====================================================================
-- 2. Branding storage bucket (public)
-- ====================================================================
insert into storage.buckets (id, name, public)
  values ('branding', 'branding', true)
  on conflict (id) do update set public = true;

drop policy if exists "branding bucket: read all" on storage.objects;
create policy "branding bucket: read all"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'branding');

drop policy if exists "branding bucket: admin write" on storage.objects;
create policy "branding bucket: admin write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branding' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "branding bucket: admin update" on storage.objects;
create policy "branding bucket: admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'branding' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "branding bucket: admin delete" on storage.objects;
create policy "branding bucket: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'branding' and public.has_role(auth.uid(), 'admin'));

-- ====================================================================
-- 3. Invite codes (admin-generated, single-use)
-- ====================================================================
create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  role        text not null default 'developer' check (role in ('admin','developer','reviewer')),
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz,
  revoked_at  timestamptz
);

create index if not exists invite_codes_code_idx on public.invite_codes(code);

alter table public.invite_codes enable row level security;

drop policy if exists "invite_codes: admin read" on public.invite_codes;
create policy "invite_codes: admin read"
  on public.invite_codes for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "invite_codes: admin write" on public.invite_codes;
create policy "invite_codes: admin write"
  on public.invite_codes for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
