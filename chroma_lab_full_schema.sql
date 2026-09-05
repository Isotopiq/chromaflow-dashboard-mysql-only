-- =====================================================================
-- CHROMA.LAB — Self-hosted Postgres bootstrap (NO Supabase required)
-- =====================================================================
-- Run this ONCE on a fresh Postgres database (>= 14).
-- The app authenticates via its own `app_users` table; RLS reads the
-- current user from a per-transaction GUC (`app.user_id`).
--
-- The app's role pool sets the GUC inside every request transaction:
--     SELECT set_config('app.user_id', '<uuid>', true);
--     SELECT set_config('app.is_admin', 'true|false', true);
--
-- Safe to re-run: every statement is idempotent.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- 0. App users (replaces Supabase auth.users)
-- =====================================================================
create table if not exists public.app_users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique not null,
  password_hash     text not null,
  email_verified_at timestamptz,
  reset_token       text,
  reset_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists app_users_email_idx       on public.app_users(lower(email));
create index if not exists app_users_reset_token_idx on public.app_users(reset_token);

-- =====================================================================
-- 1. Per-request context helpers (replace auth.uid())
-- =====================================================================
create or replace function public.current_app_user() returns uuid
  language sql stable as $$
    select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function public.current_app_is_admin() returns boolean
  language sql stable as $$
    select coalesce(current_setting('app.is_admin', true) = 'true', false)
$$;

-- =====================================================================
-- 2. Roles
-- =====================================================================
do $$ begin
  create type public.app_role as enum ('admin', 'developer', 'reviewer', 'user');
exception when duplicate_object then null; end $$;

-- Add 'user' to existing enum if the type already existed without it
do $$ begin
  alter type public.app_role add value if not exists 'user';
exception when others then null; end $$;

create table if not exists public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete cascade not null,
  role    public.app_role not null,
  unique (user_id, role)
);

alter table public.user_roles enable row level security;
drop policy if exists "user_roles: self read" on public.user_roles;
create policy "user_roles: self read"
  on public.user_roles for select
  using (user_id = public.current_app_user() or public.current_app_is_admin());

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

-- =====================================================================
-- 3. Profiles
-- =====================================================================
create table if not exists public.profiles (
  id           uuid primary key references public.app_users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles: self read"   on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
create policy "profiles: self read"
  on public.profiles for select
  using (id = public.current_app_user() or public.current_app_is_admin());
create policy "profiles: self update"
  on public.profiles for update
  using (id = public.current_app_user() or public.current_app_is_admin())
  with check (id = public.current_app_user() or public.current_app_is_admin());
drop policy if exists "profiles: self insert" on public.profiles;
create policy "profiles: self insert"
  on public.profiles for insert
  with check (id = public.current_app_user() or public.current_app_is_admin());

-- App calls this from its signup server route inside the same transaction
-- that creates the auth user, so the trigger is no longer required.
-- Provided here as a convenience to ensure existing rows get profiles.
create or replace function public.ensure_profile(_user_id uuid, _display_name text)
returns void language plpgsql as $$
begin
  insert into public.profiles (id, display_name)
  values (_user_id, _display_name)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (_user_id, 'developer')
  on conflict (user_id, role) do nothing;
end $$;

-- =====================================================================
-- 4. Core lab tables
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
  owner_id         uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.columns enable row level security;
drop policy if exists "columns: read all"   on public.columns;
drop policy if exists "columns: write auth" on public.columns;
create policy "columns: read all" on public.columns for select using (true);
create policy "columns: write auth" on public.columns for all
  using (owner_id = public.current_app_user() or public.current_app_is_admin() or owner_id is null)
  with check (true);

-- ---- column_service_events ----
-- Tracks guard changes, maintenance, resets, and installs for columns.
create table if not exists public.column_service_events (
  id                uuid primary key default gen_random_uuid(),
  column_id         uuid not null references public.columns(id) on delete cascade,
  kind              text not null check (kind in ('reset','guard_change','maintenance','install')),
  injections_before int  default 0,
  injections_after  int  default 0,
  reset_usage       boolean default false,
  serial            text default '',
  notes             text default '',
  performed_by      uuid references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists column_service_events_column_idx on public.column_service_events(column_id);
alter table public.column_service_events enable row level security;
drop policy if exists "column_service_events: read all"   on public.column_service_events;
drop policy if exists "column_service_events: write auth" on public.column_service_events;
create policy "column_service_events: read all" on public.column_service_events for select using (true);
create policy "column_service_events: write auth" on public.column_service_events for all
  using (true)
  with check (true);

-- ---- column_injections ----
-- Tracks individual injections logged per column: sequence name, injection
-- number, starting pressure, assigned method, optional linked run.
create table if not exists public.column_injections (
  id                uuid primary key default gen_random_uuid(),
  column_id         uuid not null references public.columns(id) on delete cascade,
  run_id            uuid references public.runs(id) on delete set null,
  method_id         uuid references public.methods(id) on delete set null,
  sequence_name     text not null default '',
  injection_num     int  not null,
  starting_pressure double precision,
  notes             text default '',
  performed_by      uuid references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists column_injections_column_idx on public.column_injections(column_id);
create index if not exists column_injections_run_idx on public.column_injections(run_id);
alter table public.column_injections enable row level security;
drop policy if exists "column_injections: read all"   on public.column_injections;
drop policy if exists "column_injections: write auth" on public.column_injections;
create policy "column_injections: read all" on public.column_injections for select using (true);
create policy "column_injections: write auth" on public.column_injections for all
  using (performed_by = public.current_app_user() or public.current_app_is_admin() or performed_by is null)
  with check (true);

-- ---- methods ----
create table if not exists public.methods (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  modality        text default 'RP-LC-MS',
  column_id       uuid references public.columns(id) on delete set null,
  gradient_json   jsonb default '[]'::jsonb,
  ms_params_json  jsonb default '{}'::jsonb,
  ms_scans_json   jsonb default '[]'::jsonb,
  method_file_path text,
  method_file_name text,
  notes_md        text default '',
  status          text default 'draft' check (status in ('draft','validated','archived')),
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Add columns to existing tables if they were created before this migration
do $$ begin
  alter table public.methods add column if not exists ms_scans_json jsonb default '[]'::jsonb;
exception when others then null; end $$;
do $$ begin
  alter table public.methods add column if not exists method_file_path text;
exception when others then null; end $$;
do $$ begin
  alter table public.methods add column if not exists method_file_name text;
exception when others then null; end $$;
alter table public.methods enable row level security;
drop policy if exists "methods: read all"   on public.methods;
drop policy if exists "methods: write auth" on public.methods;
create policy "methods: read all" on public.methods for select using (true);
create policy "methods: write auth" on public.methods for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
  with check (true);

-- ---- batches ----
create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  project     text default '',
  status      text default 'in_progress' check (status in ('in_progress','review','complete')),
  notes       text default '',
  owner_id    uuid references public.app_users(id) on delete set null,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
-- Add columns to existing tables if they were created before this migration
do $$ begin
  alter table public.batches add column if not exists status text default 'in_progress' check (status in ('in_progress','review','complete'));
exception when others then null; end $$;
do $$ begin
  alter table public.batches add column if not exists notes text default '';
exception when others then null; end $$;
alter table public.batches enable row level security;
drop policy if exists "batches: read all"   on public.batches;
drop policy if exists "batches: write auth" on public.batches;
create policy "batches: read all" on public.batches for select using (true);
create policy "batches: write auth" on public.batches for all
  using (owner_id = public.current_app_user() or public.current_app_is_admin() or owner_id is null)
  with check (true);

-- ---- analytes ----
create table if not exists public.analytes (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  formula        text default '',
  mz             double precision,
  rt_expected    double precision default 0,
  library_source text default 'user',
  created_by     uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Track system analytes deliberately deleted by users so they are
-- not re-seeded on redeploy.
create table if not exists public.deleted_system_analytes (
  name        text primary key,
  deleted_at  timestamptz not null default now()
);
alter table public.analytes enable row level security;
drop policy if exists "analytes: read all"   on public.analytes;
drop policy if exists "analytes: write auth" on public.analytes;
create policy "analytes: read all" on public.analytes for select using (true);
create policy "analytes: write auth" on public.analytes for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
  with check (true);

-- ---- analyte_column_rt: per-column retention time overrides ----
-- RT changes with each column. This table stores column-specific RT
-- values for each analyte. When present, the column-specific RT is used
-- for auto-annotation instead of the default rt_expected on the analyte.
create table if not exists public.analyte_column_rt (
  id          uuid primary key default gen_random_uuid(),
  analyte_id  uuid not null references public.analytes(id) on delete cascade,
  column_id   uuid not null references public.columns(id) on delete cascade,
  rt_expected double precision not null,
  notes       text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (analyte_id, column_id)
);
create index if not exists analyte_column_rt_analyte_idx on public.analyte_column_rt(analyte_id);
create index if not exists analyte_column_rt_column_idx  on public.analyte_column_rt(column_id);
alter table public.analyte_column_rt enable row level security;
drop policy if exists "analyte_column_rt: read all"   on public.analyte_column_rt;
drop policy if exists "analyte_column_rt: write auth" on public.analyte_column_rt;
create policy "analyte_column_rt: read all" on public.analyte_column_rt for select using (true);
create policy "analyte_column_rt: write auth" on public.analyte_column_rt for all
  using (true)
  with check (true);

-- ---- compound_lists ----
-- Named, reusable subsets of the analyte library for targeted peak ID.
create table if not exists public.compound_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.compound_lists enable row level security;
drop policy if exists "compound_lists: read all"   on public.compound_lists;
drop policy if exists "compound_lists: write auth" on public.compound_lists;
create policy "compound_lists: read all" on public.compound_lists for select using (true);
create policy "compound_lists: write auth" on public.compound_lists for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
  with check (true);

-- ---- compound_list_entries ----
create table if not exists public.compound_list_entries (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.compound_lists(id) on delete cascade,
  analyte_id  uuid not null references public.analytes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (list_id, analyte_id)
);
create index if not exists compound_list_entries_list_idx on public.compound_list_entries(list_id);
alter table public.compound_list_entries enable row level security;
drop policy if exists "compound_list_entries: read all"   on public.compound_list_entries;
drop policy if exists "compound_list_entries: write auth" on public.compound_list_entries;
create policy "compound_list_entries: read all" on public.compound_list_entries for select using (true);
create policy "compound_list_entries: write auth" on public.compound_list_entries for all
  using (true) with check (true);

-- ---- method_column_list_defaults ----
-- Assigns a default compound list per method+column pair for auto-selection
-- during mzXML upload.
create table if not exists public.method_column_list_defaults (
  id          uuid primary key default gen_random_uuid(),
  method_id   uuid not null references public.methods(id) on delete cascade,
  column_id   uuid not null references public.columns(id) on delete cascade,
  list_id     uuid not null references public.compound_lists(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (method_id, column_id)
);
alter table public.method_column_list_defaults enable row level security;
drop policy if exists "method_column_list_defaults: read all"   on public.method_column_list_defaults;
drop policy if exists "method_column_list_defaults: write auth" on public.method_column_list_defaults;
create policy "method_column_list_defaults: read all" on public.method_column_list_defaults for select using (true);
create policy "method_column_list_defaults: write auth" on public.method_column_list_defaults for all
  using (true) with check (true);

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
  notes           text default '',
  uploaded_by     uuid references public.app_users(id) on delete set null,
  acquired_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
do $$ begin
  alter table public.runs add column if not exists notes text default '';
exception when others then null; end $$;
do $$ begin
  alter table public.runs add column if not exists injection_id uuid references public.column_injections(id) on delete set null;
exception when others then null; end $$;
alter table public.runs enable row level security;
drop policy if exists "runs: read all"   on public.runs;
drop policy if exists "runs: write auth" on public.runs;
create policy "runs: read all" on public.runs for select using (true);
create policy "runs: write auth" on public.runs for all
  using (uploaded_by = public.current_app_user() or public.current_app_is_admin() or uploaded_by is null)
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
  annotated_by      uuid references public.app_users(id) on delete set null,
  annotation_source text,
  confidence        double precision,
  manual            boolean default false,
  notes             text default '',
  r2                double precision,
  asymmetry         double precision,
  created_at        timestamptz not null default now()
);
do $$ begin
  alter table public.peaks add column if not exists r2 double precision;
exception when others then null; end $$;
do $$ begin
  alter table public.peaks add column if not exists asymmetry double precision;
exception when others then null; end $$;
create index if not exists peaks_run_idx     on public.peaks(run_id);
create index if not exists peaks_analyte_idx on public.peaks(analyte_id);

alter table public.peaks enable row level security;
drop policy if exists "peaks: read all"   on public.peaks;
drop policy if exists "peaks: write auth" on public.peaks;
create policy "peaks: read all" on public.peaks for select using (true);
create policy "peaks: write auth" on public.peaks for all using (true) with check (true);

-- ---- annotations ----
create table if not exists public.annotations (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs(id) on delete cascade,
  peak_id    uuid references public.peaks(id) on delete cascade,
  label      text not null,
  author_id  uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.annotations enable row level security;
drop policy if exists "annotations: read all"   on public.annotations;
drop policy if exists "annotations: write auth" on public.annotations;
create policy "annotations: read all" on public.annotations for select using (true);
create policy "annotations: write auth" on public.annotations for all
  using (author_id = public.current_app_user() or public.current_app_is_admin() or author_id is null)
  with check (true);

-- =====================================================================
-- 5. Reports + sharing + audit
-- =====================================================================
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  template     text not null,
  run_ids      uuid[] not null default '{}',
  batch_id     uuid references public.batches(id) on delete set null,
  storage_path text not null,
  created_by   uuid references public.app_users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports: owner read"   on public.reports;
drop policy if exists "reports: owner write"  on public.reports;
drop policy if exists "reports: owner delete" on public.reports;
create policy "reports: owner read"
  on public.reports for select
  using (created_by = public.current_app_user() or public.current_app_is_admin());
create policy "reports: owner write"
  on public.reports for insert
  with check (created_by = public.current_app_user() or public.current_app_is_admin());
create policy "reports: owner delete"
  on public.reports for delete
  using (created_by = public.current_app_user() or public.current_app_is_admin());

create table if not exists public.shared_links (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,
  resource_kind text not null check (resource_kind in ('run','report')),
  resource_id   uuid not null,
  expires_at    timestamptz,
  created_by    uuid references public.app_users(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists shared_links_token_idx on public.shared_links(token);
alter table public.shared_links enable row level security;
drop policy if exists "shared_links: owner manage" on public.shared_links;
create policy "shared_links: owner manage"
  on public.shared_links for all
  using (created_by = public.current_app_user() or public.current_app_is_admin())
  with check (created_by = public.current_app_user() or public.current_app_is_admin());

create table if not exists public.audit_events (
  id         bigserial primary key,
  actor_id   uuid references public.app_users(id) on delete set null,
  table_name text not null,
  row_id     text,
  action     text not null,
  diff       jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
drop policy if exists "audit: admin read" on public.audit_events;
create policy "audit: admin read"
  on public.audit_events for select
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));

create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.current_app_user();
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
-- 6. Branding + invite codes
-- =====================================================================
create table if not exists public.branding_settings (
  id                   int primary key default 1,
  favicon_path         text,
  web_logo_path        text,
  pdf_logo_path        text,
  favicon_url          text,
  web_logo_url         text,
  pdf_logo_url         text,
  web_logo_light_path  text,
  web_logo_light_url   text,
  web_logo_dark_path   text,
  web_logo_dark_url    text,
  app_name             text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.app_users(id) on delete set null,
  constraint branding_singleton check (id = 1)
);
alter table public.branding_settings add column if not exists favicon_url         text;
alter table public.branding_settings add column if not exists web_logo_url        text;
alter table public.branding_settings add column if not exists pdf_logo_url        text;
alter table public.branding_settings add column if not exists web_logo_light_path text;
alter table public.branding_settings add column if not exists web_logo_light_url  text;
alter table public.branding_settings add column if not exists web_logo_dark_path  text;
alter table public.branding_settings add column if not exists web_logo_dark_url   text;
insert into public.branding_settings (id) values (1) on conflict (id) do nothing;
alter table public.branding_settings enable row level security;
drop policy if exists "branding: read all"   on public.branding_settings;
drop policy if exists "branding: admin write" on public.branding_settings;
create policy "branding: read all"   on public.branding_settings for select using (true);
create policy "branding: admin write" on public.branding_settings for update
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'))
  with check (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));

create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  role        text not null default 'developer' check (role in ('admin','developer','reviewer')),
  note        text,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  used_by     uuid references public.app_users(id) on delete set null,
  used_at     timestamptz,
  revoked_at  timestamptz
);
create index if not exists invite_codes_code_idx on public.invite_codes(code);
alter table public.invite_codes enable row level security;
drop policy if exists "invite_codes: admin read"  on public.invite_codes;
drop policy if exists "invite_codes: admin write" on public.invite_codes;
create policy "invite_codes: admin read"  on public.invite_codes for select
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));
create policy "invite_codes: admin write" on public.invite_codes for all
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'))
  with check (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));

-- =====================================================================
-- Done. Storage objects live in your S3-compatible bucket (no SQL needed).
-- =====================================================================

-- =====================================================================
-- 7. Storage settings (admin-configurable S3 via the UI)
-- =====================================================================
create table if not exists public.storage_settings (
  id                   int primary key default 1,
  s3_endpoint          text,
  s3_region            text,
  s3_bucket            text,
  s3_access_key_id     text,
  s3_secret_access_key text,
  s3_public_url_base   text,
  s3_force_path_style  boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.app_users(id) on delete set null,
  constraint storage_singleton check (id = 1)
);
insert into public.storage_settings (id) values (1) on conflict (id) do nothing;
alter table public.storage_settings enable row level security;
drop policy if exists "storage: admin read"  on public.storage_settings;
drop policy if exists "storage: admin write" on public.storage_settings;
create policy "storage: admin read"  on public.storage_settings for select
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));
create policy "storage: admin write" on public.storage_settings for all
  using (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'))
  with check (public.current_app_is_admin() or public.has_role(public.current_app_user(),'admin'));

-- =====================================================================
-- 7. Notifications
-- =====================================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.app_users(id) on delete cascade not null,
  kind        text not null check (kind in ('column_eol','batch_review','run_failed','run_parsed','calibration_drift','qc_fail','system','mention')),
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id) where read_at is null;
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "notifications: owner read"   on public.notifications;
drop policy if exists "notifications: owner update" on public.notifications;
drop policy if exists "notifications: owner insert" on public.notifications;
create policy "notifications: owner read"
  on public.notifications for select
  using (user_id = public.current_app_user());
create policy "notifications: owner update"
  on public.notifications for update
  using (user_id = public.current_app_user())
  with check (user_id = public.current_app_user());
create policy "notifications: owner insert"
  on public.notifications for insert
  with check (user_id = public.current_app_user() or public.current_app_is_admin());

-- Helper: create a notification for a user (admin context, bypasses RLS).
-- Deduplicates: if an unread notification of the same kind + link exists,
-- it updates the body/timestamp instead of inserting a duplicate.
create or replace function public.create_notification(
  _user_id uuid,
  _kind    text,
  _title   text,
  _body    text,
  _link    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  -- Check for an existing unread notification of the same kind + link
  select id into existing_id
    from public.notifications
   where user_id = _user_id
     and kind = _kind
     and link = _link
     and read_at is null
   order by created_at desc
   limit 1;

  if existing_id is not null then
    update public.notifications
      set title = _title, body = _body, created_at = now()
      where id = existing_id;
    return existing_id;
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
    values (_user_id, _kind, _title, _body, _link)
    returning id into new_id;
  return new_id;
end $$;

-- =====================================================================
-- Done.
-- =====================================================================

-- =====================================================================
-- 8. Quantitation & calibration
-- =====================================================================

-- Calibration standards: known-concentration samples linked to analytes + peaks
create table if not exists public.calibration_standards (
  id               uuid primary key default gen_random_uuid(),
  analyte_id       uuid references public.analytes(id) on delete cascade not null,
  run_id           uuid references public.runs(id) on delete cascade not null,
  peak_id          uuid references public.peaks(id) on delete cascade,
  concentration    double precision not null,
  concentration_unit text default 'ng/mL',
  response         double precision,
  response_type    text default 'area' check (response_type in ('area','height')),
  level            int,
  excluded         boolean default false,
  created_by       uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists cal_std_analyte_idx on public.calibration_standards(analyte_id);
create index if not exists cal_std_run_idx on public.calibration_standards(run_id);

alter table public.calibration_standards enable row level security;
drop policy if exists "cal_std: read all"   on public.calibration_standards;
drop policy if exists "cal_std: write auth" on public.calibration_standards;
create policy "cal_std: read all" on public.calibration_standards for select using (true);
create policy "cal_std: write auth" on public.calibration_standards for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
  with check (true);

-- Calibration curves: fitted model per analyte (optionally per batch/method)
create table if not exists public.calibration_curves (
  id            uuid primary key default gen_random_uuid(),
  analyte_id    uuid references public.analytes(id) on delete cascade not null,
  batch_id      uuid references public.batches(id) on delete set null,
  method_id     uuid references public.methods(id) on delete set null,
  name          text default '',
  model_type    text default 'linear' check (model_type in ('linear','weighted_linear','quad')),
  weighting     text default 'none' check (weighting in ('none','1/x','1/x2')),
  slope         double precision,
  intercept     double precision,
  r_squared     double precision,
  lod           double precision,
  loq           double precision,
  lod_n         int default 3,
  loq_n         int default 10,
  range_low     double precision,
  range_high    double precision,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists cal_curve_analyte_idx on public.calibration_curves(analyte_id);

alter table public.calibration_curves enable row level security;
drop policy if exists "cal_curve: read all"   on public.calibration_curves;
drop policy if exists "cal_curve: write auth" on public.calibration_curves;
create policy "cal_curve: read all" on public.calibration_curves for select using (true);
create policy "cal_curve: write auth" on public.calibration_curves for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
  with check (true);

-- QC samples: quality control checks against a calibration curve
create table if not exists public.qc_samples (
  id             uuid primary key default gen_random_uuid(),
  curve_id       uuid references public.calibration_curves(id) on delete cascade not null,
  run_id         uuid references public.runs(id) on delete cascade not null,
  peak_id        uuid references public.peaks(id) on delete cascade,
  expected_conc  double precision not null,
  measured_conc  double precision,
  accuracy_pct   double precision,
  passed         boolean,
  acceptance_pct double precision default 15,
  created_at     timestamptz not null default now()
);
create index if not exists qc_curve_idx on public.qc_samples(curve_id);

alter table public.qc_samples enable row level security;
drop policy if exists "qc: read all"   on public.qc_samples;
drop policy if exists "qc: write auth" on public.qc_samples;
create policy "qc: read all" on public.qc_samples for select using (true);
create policy "qc: write auth" on public.qc_samples for all
  using (true)
  with check (true);

-- =====================================================================
-- 9. V3 Feature tables
-- =====================================================================

-- ---- Peak column additions (idempotent) ----
do $$ begin alter table public.peaks add column if not exists aligned_rt double precision; exception when others then null; end $$;
do $$ begin alter table public.peaks add column if not exists is_normalized_area double precision; exception when others then null; end $$;
do $$ begin alter table public.peaks add column if not exists custom_values jsonb default '{}'::jsonb; exception when others then null; end $$;
do $$ begin alter table public.peaks add column if not exists adduct_type text; exception when others then null; end $$;
do $$ begin alter table public.peaks add column if not exists deconvolved boolean default false; exception when others then null; end $$;

-- ---- RT alignment runs ----
create table if not exists public.rt_alignment_runs (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid references public.batches(id) on delete cascade,
  reference_run_id  uuid references public.runs(id) on delete set null,
  alignment_method  text default 'landmark' check (alignment_method in ('landmark','linear')),
  shift_json        jsonb default '{}'::jsonb,
  created_by        uuid references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists rt_align_batch_idx on public.rt_alignment_runs(batch_id);
alter table public.rt_alignment_runs enable row level security;
drop policy if exists "rt_align: read all" on public.rt_alignment_runs;
drop policy if exists "rt_align: write auth" on public.rt_alignment_runs;
create policy "rt_align: read all" on public.rt_alignment_runs for select using (true);
create policy "rt_align: write auth" on public.rt_alignment_runs for all
  using (true) with check (true);

-- ---- IS assignments ----
create table if not exists public.is_assignments (
  id            uuid primary key default gen_random_uuid(),
  analyte_id    uuid not null references public.analytes(id) on delete cascade,
  is_analyte_id uuid not null references public.analytes(id) on delete cascade,
  method_id     uuid references public.methods(id) on delete cascade,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (analyte_id, method_id)
);
alter table public.is_assignments enable row level security;
drop policy if exists "is_assign: read all" on public.is_assignments;
drop policy if exists "is_assign: write auth" on public.is_assignments;
create policy "is_assign: read all" on public.is_assignments for select using (true);
create policy "is_assign: write auth" on public.is_assignments for all
  using (true) with check (true);

-- ---- Sample queues ----
create table if not exists public.sample_queues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  batch_id    uuid references public.batches(id) on delete set null,
  instrument  text default '',
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.sample_queues enable row level security;
drop policy if exists "sample_queues: read all" on public.sample_queues;
drop policy if exists "sample_queues: write auth" on public.sample_queues;
create policy "sample_queues: read all" on public.sample_queues for select using (true);
create policy "sample_queues: write auth" on public.sample_queues for all
  using (true) with check (true);

create table if not exists public.sample_queue_entries (
  id               uuid primary key default gen_random_uuid(),
  queue_id         uuid not null references public.sample_queues(id) on delete cascade,
  position         int not null default 0,
  sample_name      text not null default '',
  sample_type      text default 'unknown' check (sample_type in ('unknown','blank','standard','qc','double_blank','system_suitability')),
  vial_position    text default '',
  tray_code        text default '',
  method_path      text default '',
  method_id        uuid references public.methods(id) on delete set null,
  column_id        uuid references public.columns(id) on delete set null,
  injection_volume double precision default 0,
  dilution_factor  double precision default 1,
  status           text default 'pending' check (status in ('pending','running','complete','failed')),
  run_id           uuid references public.runs(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists sample_queue_entries_queue_idx on public.sample_queue_entries(queue_id);
alter table public.sample_queue_entries enable row level security;
drop policy if exists "sample_queue_entries: read all" on public.sample_queue_entries;
drop policy if exists "sample_queue_entries: write auth" on public.sample_queue_entries;
create policy "sample_queue_entries: read all" on public.sample_queue_entries for select using (true);
create policy "sample_queue_entries: write auth" on public.sample_queue_entries for all
  using (true) with check (true);

-- ---- Method templates ----
create table if not exists public.method_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text default '',
  template_json jsonb not null default '{}'::jsonb,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.method_templates enable row level security;
drop policy if exists "method_templates: read all" on public.method_templates;
drop policy if exists "method_templates: write auth" on public.method_templates;
create policy "method_templates: read all" on public.method_templates for select using (true);
create policy "method_templates: write auth" on public.method_templates for all
  using (true) with check (true);
do $$ begin alter table public.methods add column if not exists template_id uuid references public.method_templates(id) on delete set null; exception when others then null; end $$;

-- ---- Report jobs ----
create table if not exists public.report_jobs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  template        text default 'standard',
  run_ids         uuid[] not null default '{}',
  batch_id        uuid references public.batches(id) on delete set null,
  include_sections text[] default '{}',
  output_format   text default 'pdf' check (output_format in ('pdf','xlsx','csv')),
  storage_path    text,
  email_to        text[] default '{}',
  email_sent_at   timestamptz,
  status          text default 'pending' check (status in ('pending','generating','ready','sent','failed')),
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.report_jobs enable row level security;
drop policy if exists "report_jobs: read all" on public.report_jobs;
drop policy if exists "report_jobs: write auth" on public.report_jobs;
create policy "report_jobs: read all" on public.report_jobs for select using (true);
create policy "report_jobs: write auth" on public.report_jobs for all
  using (true) with check (true);

-- ---- Adduct detections ----
create table if not exists public.adduct_detections (
  id                     uuid primary key default gen_random_uuid(),
  peak_id                uuid not null references public.peaks(id) on delete cascade,
  analyte_id             uuid references public.analytes(id) on delete set null,
  adduct_type            text not null,
  mz_observed            double precision,
  mz_theoretical         double precision,
  ppm_error              double precision,
  is_in_source_fragment  boolean default false,
  created_at             timestamptz not null default now()
);
create index if not exists adduct_det_peak_idx on public.adduct_detections(peak_id);
alter table public.adduct_detections enable row level security;
drop policy if exists "adduct_det: read all" on public.adduct_detections;
drop policy if exists "adduct_det: write auth" on public.adduct_detections;
create policy "adduct_det: read all" on public.adduct_detections for select using (true);
create policy "adduct_det: write auth" on public.adduct_detections for all
  using (true) with check (true);

-- ---- Custom calculation columns ----
create table if not exists public.custom_columns (
  id            uuid primary key default gen_random_uuid(),
  method_id     uuid references public.methods(id) on delete cascade,
  name          text not null,
  formula       text not null,
  unit          text default '',
  display_order int default 0,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists custom_cols_method_idx on public.custom_columns(method_id);
alter table public.custom_columns enable row level security;
drop policy if exists "custom_cols: read all" on public.custom_columns;
drop policy if exists "custom_cols: write auth" on public.custom_columns;
create policy "custom_cols: read all" on public.custom_columns for select using (true);
create policy "custom_cols: write auth" on public.custom_columns for all
  using (true) with check (true);

-- ---- Import watch folders ----
create table if not exists public.import_watch_folders (
  id           uuid primary key default gen_random_uuid(),
  path         text not null,
  enabled      boolean default true,
  method_id    uuid references public.methods(id) on delete set null,
  column_id    uuid references public.columns(id) on delete set null,
  batch_id     uuid references public.batches(id) on delete set null,
  file_pattern text default '*.mzXML',
  created_by   uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.import_watch_folders enable row level security;
drop policy if exists "watch_folders: read all" on public.import_watch_folders;
drop policy if exists "watch_folders: write auth" on public.import_watch_folders;
create policy "watch_folders: read all" on public.import_watch_folders for select using (true);
create policy "watch_folders: write auth" on public.import_watch_folders for all
  using (true) with check (true);

create table if not exists public.imported_files (
  id            uuid primary key default gen_random_uuid(),
  folder_id     uuid references public.import_watch_folders(id) on delete cascade,
  file_path     text not null,
  file_name     text not null,
  status        text default 'pending' check (status in ('pending','processing','imported','failed')),
  run_id        uuid references public.runs(id) on delete set null,
  error_message text,
  created_at    timestamptz not null default now()
);
create index if not exists imported_files_folder_idx on public.imported_files(folder_id);
alter table public.imported_files enable row level security;
drop policy if exists "imported_files: read all" on public.imported_files;
drop policy if exists "imported_files: write auth" on public.imported_files;
create policy "imported_files: read all" on public.imported_files for select using (true);
create policy "imported_files: write auth" on public.imported_files for all
  using (true) with check (true);

-- ---- Peak deconvolution ----
create table if not exists public.peak_deconvolution (
  id              uuid primary key default gen_random_uuid(),
  peak_id         uuid not null references public.peaks(id) on delete cascade,
  component_count int default 1,
  components_json  jsonb default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists peak_deconv_peak_idx on public.peak_deconvolution(peak_id);
alter table public.peak_deconvolution enable row level security;
drop policy if exists "peak_deconv: read all" on public.peak_deconvolution;
drop policy if exists "peak_deconv: write auth" on public.peak_deconvolution;
create policy "peak_deconv: read all" on public.peak_deconvolution for select using (true);
create policy "peak_deconv: write auth" on public.peak_deconvolution for all
  using (true) with check (true);

-- ---- NCE optimization ----
create table if not exists public.nce_optimization (
  id                  uuid primary key default gen_random_uuid(),
  analyte_id          uuid not null references public.analytes(id) on delete cascade,
  method_id           uuid references public.methods(id) on delete set null,
  nce_tested          double precision,
  best_nce            double precision,
  best_fragment_count int,
  spectra_json        jsonb default '[]'::jsonb,
  notes               text default '',
  created_by          uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists nce_opt_analyte_idx on public.nce_optimization(analyte_id);
alter table public.nce_optimization enable row level security;
drop policy if exists "nce_opt: read all" on public.nce_optimization;
drop policy if exists "nce_opt: write auth" on public.nce_optimization;
create policy "nce_opt: read all" on public.nce_optimization for select using (true);
create policy "nce_opt: write auth" on public.nce_optimization for all
  using (true) with check (true);

-- ---- Additional audit triggers for V3 ----
drop trigger if exists trg_audit_peaks on public.peaks;
create trigger trg_audit_peaks after insert or update or delete on public.peaks
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_analytes on public.analytes;
create trigger trg_audit_analytes after insert or update or delete on public.analytes
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_compound_lists on public.compound_lists;
create trigger trg_audit_compound_lists after insert or update or delete on public.compound_lists
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_cal_std on public.calibration_standards;
create trigger trg_audit_cal_std after insert or update or delete on public.calibration_standards
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_cal_curve on public.calibration_curves;
create trigger trg_audit_cal_curve after insert or update or delete on public.calibration_curves
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_col_inj on public.column_injections;
create trigger trg_audit_col_inj after insert or update or delete on public.column_injections
  for each row execute function public.log_audit();

-- =====================================================================
-- 10. V3 Buffer Exchange, QC Runs, Anomaly Checks
-- =====================================================================

-- ---- Buffer exchange events ----
-- Tracks mobile-phase / buffer composition changes per column, optionally
-- linked to a batch, so signal / RT / peak-shape shifts can be correlated.
create table if not exists public.buffer_exchange_events (
  id              uuid primary key default gen_random_uuid(),
  column_id       uuid not null references public.columns(id) on delete cascade,
  batch_id        uuid references public.batches(id) on delete set null,
  kind            text not null check (kind in ('buffer_a','buffer_b','both','solvent_lot','mobile_phase_prep')),
  old_description text default '',
  new_description text default '',
  old_lot         text default '',
  new_lot         text default '',
  reason          text default '',
  performed_by    uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists buffer_exchange_column_idx on public.buffer_exchange_events(column_id);
create index if not exists buffer_exchange_batch_idx on public.buffer_exchange_events(batch_id);
alter table public.buffer_exchange_events enable row level security;
drop policy if exists "buffer_exchange: read all" on public.buffer_exchange_events;
drop policy if exists "buffer_exchange: write auth" on public.buffer_exchange_events;
create policy "buffer_exchange: read all" on public.buffer_exchange_events for select using (true);
create policy "buffer_exchange: write auth" on public.buffer_exchange_events for all
  using (true) with check (true);

-- ---- QC runs ----
-- QC reference runs linked to a column (and optionally batch / method).
-- Each QC run references a parsed run that holds the trace + peaks.
create table if not exists public.qc_runs (
  id           uuid primary key default gen_random_uuid(),
  column_id    uuid not null references public.columns(id) on delete cascade,
  batch_id     uuid references public.batches(id) on delete set null,
  method_id    uuid references public.methods(id) on delete set null,
  run_id       uuid references public.runs(id) on delete set null,
  name         text not null,
  qc_type      text default 'system_suitability' check (qc_type in ('system_suitability','column_qc','batch_qc','reference_standard')),
  file_path    text,
  file_name    text,
  acquired_at  timestamptz not null default now(),
  uploaded_by  uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists qc_runs_column_idx on public.qc_runs(column_id);
create index if not exists qc_runs_batch_idx on public.qc_runs(batch_id);
alter table public.qc_runs enable row level security;
drop policy if exists "qc_runs: read all" on public.qc_runs;
drop policy if exists "qc_runs: write auth" on public.qc_runs;
create policy "qc_runs: read all" on public.qc_runs for select using (true);
create policy "qc_runs: write auth" on public.qc_runs for all
  using (true) with check (true);

-- ---- Anomaly checks ----
-- Stores results of automated anomaly detection across batches, samples,
-- compounds, and QC runs.
create table if not exists public.anomaly_checks (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('batch','sample','compound','qc')),
  scope_id      uuid,
  batch_id      uuid references public.batches(id) on delete cascade,
  column_id     uuid references public.columns(id) on delete cascade,
  check_type    text not null,
  severity      text default 'info' check (severity in ('info','warning','critical')),
  message       text not null,
  metrics_json  jsonb default '{}'::jsonb,
  resolved      boolean default false,
  resolved_by   uuid references public.app_users(id) on delete set null,
  resolved_at   timestamptz,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists anomaly_batch_idx on public.anomaly_checks(batch_id);
create index if not exists anomaly_column_idx on public.anomaly_checks(column_id);
create index if not exists anomaly_scope_idx on public.anomaly_checks(scope);
create index if not exists anomaly_resolved_idx on public.anomaly_checks(resolved);
alter table public.anomaly_checks enable row level security;
drop policy if exists "anomaly: read all" on public.anomaly_checks;
drop policy if exists "anomaly: write auth" on public.anomaly_checks;
create policy "anomaly: read all" on public.anomaly_checks for select using (true);
create policy "anomaly: write auth" on public.anomaly_checks for all
  using (true) with check (true);

-- ---- Audit triggers for previously-unaudited tables ----
drop trigger if exists trg_audit_columns on public.columns;
create trigger trg_audit_columns after insert or update or delete on public.columns
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_column_service on public.column_service_events;
create trigger trg_audit_column_service after insert or update or delete on public.column_service_events
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_batches on public.batches;
create trigger trg_audit_batches after insert or update or delete on public.batches
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_buffer_exchange on public.buffer_exchange_events;
create trigger trg_audit_buffer_exchange after insert or update or delete on public.buffer_exchange_events
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_qc_runs on public.qc_runs;
create trigger trg_audit_qc_runs after insert or update or delete on public.qc_runs
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_anomaly_checks on public.anomaly_checks;
create trigger trg_audit_anomaly_checks after insert or update or delete on public.anomaly_checks
  for each row execute function public.log_audit();

-- =====================================================================
-- Done.
-- =====================================================================
