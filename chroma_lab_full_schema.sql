-- =====================================================================
-- CHROMA.LAB — Full database bootstrap (consolidated)
-- =====================================================================
-- Run this ONCE on a fresh Supabase project to recreate the entire
-- database schema, RLS policies, storage buckets, and triggers used by
-- the application. It folds together every phase migration:
--   phase1/2 (core lab tables)  -- reconstructed from app code
--   phase3   (reports, shared_links, audit_events, EIC cols)
--   phase3b  (peaks.manual)
--   phase3c  (peaks.mz, peaks.analyte_name; report backfill)
--   phase4   (branding_settings, invite_codes, branding bucket)
--   phase5   (profiles.avatar_url, avatars bucket)
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS guards.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. Roles (enum + user_roles + has_role)
-- =====================================================================
do $$ begin
  create type public.app_role as enum ('admin', 'developer', 'reviewer');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role    public.app_role not null,
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all    on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "user_roles: self read" on public.user_roles;
create policy "user_roles: self read"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- =====================================================================
-- 2. Profiles + auto-provision trigger on auth.users
-- =====================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

drop policy if exists "profiles: self read"   on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
drop policy if exists "profiles: admin read"  on public.profiles;
create policy "profiles: self read"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "profiles: self update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name',
             split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  -- Default role; can be overridden by invite-code consumption.
  insert into public.user_roles (user_id, role)
  values (new.id, 'developer')
  on conflict (user_id, role) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 3. Core lab tables
-- =====================================================================

-- ---- columns ----
create table if not exists public.columns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  chemistry        text default '',
  dimensions       text default '',
  particle_size    text default '',
  serial           text default '',
  manufacturer     text default '',
  rated_injections int  default 1000,
  used_injections  int  default 0,
  status           text default 'healthy' check (status in ('healthy','warn','expired')),
  pressure_trend   jsonb default '[]'::jsonb,
  notes_md         text default '',
  installed_at     timestamptz default now(),
  owner_id         uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
grant select, insert, update, delete on public.columns to authenticated;
grant all on public.columns to service_role;
alter table public.columns enable row level security;

drop policy if exists "columns: read all"   on public.columns;
drop policy if exists "columns: write auth" on public.columns;
create policy "columns: read all"   on public.columns for select to authenticated using (true);
create policy "columns: write auth" on public.columns for all    to authenticated
  using (owner_id = auth.uid() or public.has_role(auth.uid(),'admin') or owner_id is null)
  with check (true);

-- ---- methods ----
create table if not exists public.methods (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  modality        text default 'RP-LC-MS',
  column_id       uuid references public.columns(id) on delete set null,
  gradient_json   jsonb default '[]'::jsonb,
  ms_params_json  jsonb default '{}'::jsonb,
  notes_md        text default '',
  status          text default 'draft' check (status in ('draft','validated','archived')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
grant select, insert, update, delete on public.methods to authenticated;
grant all on public.methods to service_role;
alter table public.methods enable row level security;
drop policy if exists "methods: read all"  on public.methods;
drop policy if exists "methods: write auth" on public.methods;
create policy "methods: read all"  on public.methods for select to authenticated using (true);
create policy "methods: write auth" on public.methods for all to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin') or created_by is null)
  with check (true);

-- ---- batches ----
create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  project     text default '',
  owner_id    uuid references auth.users(id) on delete set null,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
grant select, insert, update, delete on public.batches to authenticated;
grant all on public.batches to service_role;
alter table public.batches enable row level security;
drop policy if exists "batches: read all"   on public.batches;
drop policy if exists "batches: write auth" on public.batches;
create policy "batches: read all"   on public.batches for select to authenticated using (true);
create policy "batches: write auth" on public.batches for all to authenticated
  using (owner_id = auth.uid() or public.has_role(auth.uid(),'admin') or owner_id is null)
  with check (true);

-- ---- analytes ----
create table if not exists public.analytes (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  formula        text default '',
  mz             double precision,
  rt_expected    double precision default 0,
  library_source text default 'user',
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
grant select, insert, update, delete on public.analytes to authenticated;
grant all on public.analytes to service_role;
alter table public.analytes enable row level security;
drop policy if exists "analytes: read all"  on public.analytes;
drop policy if exists "analytes: write auth" on public.analytes;
create policy "analytes: read all"  on public.analytes for select to authenticated using (true);
create policy "analytes: write auth" on public.analytes for all to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin') or created_by is null)
  with check (true);

-- ---- runs ----
create table if not exists public.runs (
  id              uuid primary key default gen_random_uuid(),
  method_id       uuid references public.methods(id) on delete set null,
  column_id       uuid references public.columns(id) on delete set null,
  batch_id        uuid references public.batches(id) on delete set null,
  file_path       text not null,
  file_format     text default 'mzML' check (file_format in ('mzML','mzXML','raw')),
  scans_blob_path text,
  ms_level        smallint default 1,
  parsed_status   text default 'parsed' check (parsed_status in ('parsed','parsing','failed')),
  summary_json    jsonb default '{}'::jsonb,
  uploaded_by     uuid references auth.users(id) on delete set null,
  acquired_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
grant select, insert, update, delete on public.runs to authenticated;
grant all on public.runs to service_role;
alter table public.runs enable row level security;
drop policy if exists "runs: read all"   on public.runs;
drop policy if exists "runs: write auth" on public.runs;
create policy "runs: read all"   on public.runs for select to authenticated using (true);
create policy "runs: write auth" on public.runs for all to authenticated
  using (uploaded_by = auth.uid() or public.has_role(auth.uid(),'admin') or uploaded_by is null)
  with check (true);

-- ---- peaks ----
create table if not exists public.peaks (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.runs(id) on delete cascade,
  rt                double precision not null,
  area              double precision default 0,
  height            double precision default 0,
  fwhm              double precision default 0,
  sn                double precision default 0,
  mz                double precision,
  mz_low            double precision,
  mz_high           double precision,
  analyte_id        uuid references public.analytes(id) on delete set null,
  analyte_name      text,
  annotated_by      uuid references auth.users(id) on delete set null,
  annotation_source text,
  confidence        double precision,
  manual            boolean default false,
  created_at        timestamptz not null default now()
);
create index if not exists peaks_run_idx     on public.peaks(run_id);
create index if not exists peaks_analyte_idx on public.peaks(analyte_id);

grant select, insert, update, delete on public.peaks to authenticated;
grant all on public.peaks to service_role;
alter table public.peaks enable row level security;
drop policy if exists "peaks: read all"  on public.peaks;
drop policy if exists "peaks: write auth" on public.peaks;
create policy "peaks: read all"  on public.peaks for select to authenticated using (true);
create policy "peaks: write auth" on public.peaks for all to authenticated
  using (true) with check (true);

-- ---- annotations ----
create table if not exists public.annotations (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs(id) on delete cascade,
  peak_id    uuid references public.peaks(id) on delete cascade,
  label      text not null,
  author_id  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.annotations to authenticated;
grant all on public.annotations to service_role;
alter table public.annotations enable row level security;
drop policy if exists "annotations: read all"   on public.annotations;
drop policy if exists "annotations: write auth" on public.annotations;
create policy "annotations: read all"   on public.annotations for select to authenticated using (true);
create policy "annotations: write auth" on public.annotations for all to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(),'admin') or author_id is null)
  with check (true);

-- =====================================================================
-- 4. Reports + sharing + audit (phase 3)
-- =====================================================================
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  template     text not null,
  run_ids      uuid[] not null default '{}',
  batch_id     uuid references public.batches(id) on delete set null,
  storage_path text not null,
  created_by   uuid references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
grant select, insert, update, delete on public.reports to authenticated;
grant all on public.reports to service_role;
alter table public.reports enable row level security;
drop policy if exists "reports: owner read"   on public.reports;
drop policy if exists "reports: owner write"  on public.reports;
drop policy if exists "reports: owner delete" on public.reports;
create policy "reports: owner read"   on public.reports for select to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "reports: owner write"  on public.reports for insert to authenticated
  with check (created_by = auth.uid());
create policy "reports: owner delete" on public.reports for delete to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'));

create table if not exists public.shared_links (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,
  resource_kind text not null check (resource_kind in ('run','report')),
  resource_id   uuid not null,
  expires_at    timestamptz,
  created_by    uuid references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists shared_links_token_idx on public.shared_links(token);
grant select, insert, update, delete on public.shared_links to authenticated;
grant all on public.shared_links to service_role;
alter table public.shared_links enable row level security;
drop policy if exists "shared_links: owner manage" on public.shared_links;
create policy "shared_links: owner manage"
  on public.shared_links for all to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'))
  with check (created_by = auth.uid());

create table if not exists public.audit_events (
  id         bigserial primary key,
  actor_id   uuid references auth.users(id) on delete set null,
  table_name text not null,
  row_id     text,
  action     text not null,
  diff       jsonb,
  created_at timestamptz not null default now()
);
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
alter table public.audit_events enable row level security;
drop policy if exists "audit: admin read" on public.audit_events;
create policy "audit: admin read"
  on public.audit_events for select to authenticated
  using (public.has_role(auth.uid(),'admin'));

create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  insert into public.audit_events(actor_id, table_name, row_id, action, diff)
  values (
    actor,
    tg_table_name,
    coalesce((case when tg_op='DELETE' then old.id::text else new.id::text end), null),
    lower(tg_op),
    case
      when tg_op='INSERT' then to_jsonb(new)
      when tg_op='DELETE' then to_jsonb(old)
      else jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_runs on public.runs;
create trigger trg_audit_runs after insert or update or delete on public.runs
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_methods on public.methods;
create trigger trg_audit_methods after insert or update or delete on public.methods
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_annotations on public.annotations;
create trigger trg_audit_annotations after insert or update or delete on public.annotations
  for each row execute function public.log_audit();

-- =====================================================================
-- 5. Branding + invite codes (phase 4)
-- =====================================================================
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
grant select on public.branding_settings to anon, authenticated;
grant all on public.branding_settings to service_role;
alter table public.branding_settings enable row level security;
drop policy if exists "branding: read all"   on public.branding_settings;
drop policy if exists "branding: admin write" on public.branding_settings;
create policy "branding: read all"
  on public.branding_settings for select to anon, authenticated using (true);
create policy "branding: admin write"
  on public.branding_settings for update to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

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
grant select, insert, update, delete on public.invite_codes to authenticated;
grant all on public.invite_codes to service_role;
alter table public.invite_codes enable row level security;
drop policy if exists "invite_codes: admin read"  on public.invite_codes;
drop policy if exists "invite_codes: admin write" on public.invite_codes;
create policy "invite_codes: admin read"
  on public.invite_codes for select to authenticated
  using (public.has_role(auth.uid(),'admin'));
create policy "invite_codes: admin write"
  on public.invite_codes for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- =====================================================================
-- 6. Storage buckets + policies
-- =====================================================================

-- raw-runs: private; per-user write, authenticated read
insert into storage.buckets (id, name, public)
  values ('raw-runs','raw-runs', false)
  on conflict (id) do nothing;

drop policy if exists "raw-runs: auth read"    on storage.objects;
drop policy if exists "raw-runs: owner write"  on storage.objects;
drop policy if exists "raw-runs: owner update" on storage.objects;
drop policy if exists "raw-runs: owner delete" on storage.objects;
create policy "raw-runs: auth read"
  on storage.objects for select to authenticated
  using (bucket_id = 'raw-runs');
create policy "raw-runs: owner write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'raw-runs' and owner = auth.uid());
create policy "raw-runs: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'raw-runs' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));
create policy "raw-runs: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'raw-runs' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));

-- reports: private
insert into storage.buckets (id, name, public)
  values ('reports','reports', false)
  on conflict (id) do nothing;
drop policy if exists "reports bucket: owner read"   on storage.objects;
drop policy if exists "reports bucket: owner write"  on storage.objects;
drop policy if exists "reports bucket: owner delete" on storage.objects;
create policy "reports bucket: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));
create policy "reports bucket: owner write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and owner = auth.uid());
create policy "reports bucket: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));

-- branding: public read, admin write
insert into storage.buckets (id, name, public)
  values ('branding','branding', true)
  on conflict (id) do update set public = true;
drop policy if exists "branding bucket: read all"     on storage.objects;
drop policy if exists "branding bucket: admin write"  on storage.objects;
drop policy if exists "branding bucket: admin update" on storage.objects;
drop policy if exists "branding bucket: admin delete" on storage.objects;
create policy "branding bucket: read all"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'branding');
create policy "branding bucket: admin write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));
create policy "branding bucket: admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));
create policy "branding bucket: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));

-- avatars: public read, per-user folder write
insert into storage.buckets (id, name, public)
  values ('avatars','avatars', true)
  on conflict (id) do update set public = true;
drop policy if exists "avatars: read all"      on storage.objects;
drop policy if exists "avatars: owner insert"  on storage.objects;
drop policy if exists "avatars: owner update"  on storage.objects;
drop policy if exists "avatars: owner delete"  on storage.objects;
create policy "avatars: read all"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy "avatars: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Done. Refresh PostgREST schema cache so the Data API picks everything up.
-- =====================================================================
notify pgrst, 'reload schema';
