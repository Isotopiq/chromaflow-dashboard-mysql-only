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
  create type public.app_role as enum ('admin', 'developer', 'reviewer');
exception when duplicate_object then null; end $$;

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
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
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
  owner_id    uuid references public.app_users(id) on delete set null,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
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
alter table public.analytes enable row level security;
drop policy if exists "analytes: read all"   on public.analytes;
drop policy if exists "analytes: write auth" on public.analytes;
create policy "analytes: read all" on public.analytes for select using (true);
create policy "analytes: write auth" on public.analytes for all
  using (created_by = public.current_app_user() or public.current_app_is_admin() or created_by is null)
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
  uploaded_by     uuid references public.app_users(id) on delete set null,
  acquired_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
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
  created_at        timestamptz not null default now()
);
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
  id            int primary key default 1,
  favicon_path  text,
  web_logo_path text,
  pdf_logo_path text,
  app_name      text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.app_users(id) on delete set null,
  constraint branding_singleton check (id = 1)
);
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
