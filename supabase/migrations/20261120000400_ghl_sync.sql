-- 20261120000400_ghl_sync.sql
-- Purpose: GoHighLevel sync jobs: one contact copy per request and one active stage-tag push per
--          request, with attempt counts, backoff and a lease. The request detail (SCR-06) reads
--          its copy and stage-tag state from here. FR-14, FR-15, FR-19, FR-24 · US-009, US-010,
--          US-014, US-017. Job rows hold no token and no personal data (AC-010.5, AC-017.13).
-- Decision: docs/decisions/0004-ghl-sync-and-retry-schedule.md

begin;

create table if not exists public.ghl_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.quote_requests (id) on delete cascade,  -- cascade: sync state means nothing without its request
  kind             text not null check (kind in ('contact_copy', 'stage_tag')),
  target_status    text check (target_status in ('new', 'quoted', 'won', 'lost')),  -- status that started a stage-tag push (every attempt applies the current status)
  state            text not null default 'pending' check (state in ('pending', 'waiting', 'succeeded', 'failed', 'superseded')),
  attempt_count    smallint not null default 0 check (attempt_count >= 0),
  max_attempts     smallint not null default 6 check (max_attempts >= 1),  -- first attempt + 5 retries (OQ-8A); a manual retry allows one more
  next_attempt_at  timestamptz not null default now(),
  last_attempt_at  timestamptz,
  last_error_class text check (last_error_class in ('timeout', 'auth', 'rate_limited', 'server_error', 'config_missing')),
  locked_until     timestamptz,                         -- lease held by the runner that claimed the job
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ghl_sync_jobs_target_status_for_tags check ((kind = 'stage_tag') = (target_status is not null))
);

-- One contact copy per request: the copy never creates a second contact for a request (FR-15).
create unique index if not exists ghl_sync_jobs_one_copy_idx
  on public.ghl_sync_jobs (request_id) where kind = 'contact_copy';

-- One active stage-tag push per request: a later status change supersedes it (FR-24).
create unique index if not exists ghl_sync_jobs_one_active_tag_idx
  on public.ghl_sync_jobs (request_id) where kind = 'stage_tag' and state in ('pending', 'waiting');

-- Query: the runner claims due jobs, oldest due first (cron runs and after() drains).
create index if not exists ghl_sync_jobs_due_idx
  on public.ghl_sync_jobs (next_attempt_at) where state in ('pending', 'waiting');

-- Query: SCR-06 shows a request's copy job and latest stage-tag job; covers the foreign key.
create index if not exists ghl_sync_jobs_request_idx
  on public.ghl_sync_jobs (request_id, kind, created_at desc);

drop trigger if exists ghl_sync_jobs_set_updated_at on public.ghl_sync_jobs;
create trigger ghl_sync_jobs_set_updated_at before update on public.ghl_sync_jobs
  for each row execute function app_private.set_updated_at();

alter table public.ghl_sync_jobs enable row level security;
revoke all on table public.ghl_sync_jobs from anon;
revoke insert, update, delete, truncate, references, trigger on table public.ghl_sync_jobs from authenticated;

-- Staff read sync state for SCR-06. Jobs are written by the server runner (service role) and by
-- the RPCs in 20261120000600_functions.sql.
drop policy if exists ghl_sync_jobs_select_staff on public.ghl_sync_jobs;
create policy ghl_sync_jobs_select_staff on public.ghl_sync_jobs
  for select to authenticated
  using ((select app_private.is_staff()));

commit;

-- rollback
-- begin;
-- drop table if exists public.ghl_sync_jobs;   -- DESTRUCTIVE: sync history (requests are untouched)
-- commit;
