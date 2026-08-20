-- Column service / maintenance log (guard changes, injection-count resets, etc.)
create table if not exists public.column_service_events (
  id                  uuid primary key default gen_random_uuid(),
  column_id           uuid not null references public.columns(id) on delete cascade,
  kind                text not null check (kind in ('reset','guard_change','maintenance','install')),
  injections_before   int  default 0,
  injections_after    int  default 0,
  reset_usage         boolean not null default false,
  serial              text default '',
  notes               text default '',
  performed_by        uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists column_service_events_column_idx
  on public.column_service_events (column_id, created_at desc);

alter table public.column_service_events enable row level security;
drop policy if exists "column_service: read all"   on public.column_service_events;
drop policy if exists "column_service: write auth" on public.column_service_events;
create policy "column_service: read all" on public.column_service_events
  for select using (true);
create policy "column_service: write auth" on public.column_service_events
  for all using (public.current_app_user() is not null or public.current_app_is_admin())
  with check (true);
