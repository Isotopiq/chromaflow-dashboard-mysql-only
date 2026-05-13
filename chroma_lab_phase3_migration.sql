-- CHROMA.LAB — Phase 3 schema delta
-- Adds EIC (extracted ion chromatogram) support, sharing links,
-- audit log and scans-blob storage path.
--
-- Run this in your Supabase SQL editor AFTER chroma_lab_phase2_migration.sql.

-- ====================================================================
-- 1. EIC support — m/z windows on peaks, scans blob ref + ms_level on runs
-- ====================================================================
alter table public.peaks  add column if not exists mz_low  double precision;
alter table public.peaks  add column if not exists mz_high double precision;
alter table public.runs   add column if not exists scans_blob_path text;
alter table public.runs   add column if not exists ms_level        smallint default 1;

-- ====================================================================
-- 2. Reports table (used by Phase 3 PDF generator)
-- ====================================================================
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  template     text not null,                       -- 'run' | 'batch' | 'method'
  run_ids      uuid[]      not null default '{}',
  batch_id     uuid        references public.batches(id) on delete set null,
  storage_path text        not null,                -- key in 'reports' bucket
  created_by   uuid        references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy if not exists "reports: owner read"
  on public.reports for select to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy if not exists "reports: owner write"
  on public.reports for insert to authenticated
  with check (created_by = auth.uid());

create policy if not exists "reports: owner delete"
  on public.reports for delete to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ====================================================================
-- 3. Sharing links — public read tokens for runs / reports
-- ====================================================================
create table if not exists public.shared_links (
  id           uuid primary key default gen_random_uuid(),
  token        text unique not null,
  resource_kind text not null check (resource_kind in ('run','report')),
  resource_id  uuid not null,
  expires_at   timestamptz,
  created_by   uuid references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table public.shared_links enable row level security;

create policy if not exists "shared_links: owner manage"
  on public.shared_links for all to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (created_by = auth.uid());

create index if not exists shared_links_token_idx on public.shared_links(token);

-- ====================================================================
-- 4. Audit events
-- ====================================================================
create table if not exists public.audit_events (
  id          bigserial primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  table_name  text not null,
  row_id      text,
  action      text not null,            -- 'insert' | 'update' | 'delete'
  diff        jsonb,
  created_at  timestamptz not null default now()
);

alter table public.audit_events enable row level security;

create policy if not exists "audit: admin read"
  on public.audit_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

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

-- ====================================================================
-- 5. Reports storage bucket (private)
-- ====================================================================
insert into storage.buckets (id, name, public)
  values ('reports', 'reports', false)
  on conflict (id) do nothing;

create policy if not exists "reports bucket: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));

create policy if not exists "reports bucket: owner write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and owner = auth.uid());

create policy if not exists "reports bucket: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and (owner = auth.uid() or public.has_role(auth.uid(),'admin')));
