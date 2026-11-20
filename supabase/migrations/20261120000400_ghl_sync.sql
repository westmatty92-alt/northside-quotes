-- 20261120000400_ghl_sync.sql
-- Purpose: GoHighLevel sync jobs: one contact copy per request and one active stage-tag push per
--          request, with attempt counts, backoff and a lease. The request detail (SCR-06) reads
--          its copy and stage-tag state from here. FR-14, FR-15, FR-19, FR-24 · US-009, US-010,
--          US-014, US-017. Job rows hold no token and no personal data (AC-010.5, AC-017.13).
--          PRD v1.2 (ruling 1B, FR-25): a job exists only for a request whose homeowner ticked
--          the offers box; a trigger refuses any other insert, so no code path can queue one.
--          error class `rejected` (GHL 400, 404, 422) fails at once (docs/integration-contract.md).
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
  last_error_class text check (last_error_class in ('timeout', 'auth', 'rate_limited', 'server_error', 'config_missing', 'rejected')),
  locked_until     timestamptz,                         -- lease held by the runner that claimed the job
  lease_id         uuid,                                -- new for every claim; finish_ghl_job ignores a result from any other lease (S0 SEC-7)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ghl_sync_jobs_target_status_for_tags check ((kind = 'stage_tag') = (target_status is not null)),
  constraint ghl_sync_jobs_lease_pair check ((lease_id is null) = (locked_until is null))
);

-- One contact copy per request: the copy never creates a second contact for a request (FR-15).
create unique index if not exists ghl_sync_jobs_one_copy_idx
  on public.ghl_sync_jobs (request_id) where kind = 'contact_copy';

-- One active stage-tag push per request: a later status change supersedes it (FR-24).
create unique index if not exists ghl_sync_jobs_one_active_tag_idx
  on public.ghl_sync_jobs (request_id) where kind = 'stage_tag' and state in ('pending', 'waiting');

-- Query: the runner claims one due job at a time, oldest due first (cron runs and after() drains).
create index if not exists ghl_sync_jobs_due_idx
  on public.ghl_sync_jobs (next_attempt_at) where state in ('pending', 'waiting');

-- Query: SCR-06 shows a request's copy job and latest stage-tag job; covers the foreign key.
create index if not exists ghl_sync_jobs_request_idx
  on public.ghl_sync_jobs (request_id, kind, created_at desc);

drop trigger if exists ghl_sync_jobs_set_updated_at on public.ghl_sync_jobs;
create trigger ghl_sync_jobs_set_updated_at before update on public.ghl_sync_jobs
  for each row execute function app_private.set_updated_at();

-- Ruling 1B (FR-15, FR-24, AC-009.9, AC-017.16): no GHL job, of either kind, for a request whose
-- homeowner did not tick the offers box. complete_quote_request and change_quote_request_status
-- already skip those requests; this trigger makes it impossible for any other path (a bug, a
-- by-hand insert by the service role) to queue one. It also fires when an existing job is
-- repointed (`request_id`) or re-purposed (`kind`), so an update cannot move a job onto an
-- unticked request either (S0 SEC-23).
create or replace function app_private.ghl_sync_jobs_require_consent() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.quote_requests q
                  where q.id = new.request_id and q.marketing_consent) then
    raise exception 'no offers consent: nothing is sent to GoHighLevel for this request' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app_private.ghl_sync_jobs_require_consent() from public;

drop trigger if exists ghl_sync_jobs_require_consent on public.ghl_sync_jobs;
create trigger ghl_sync_jobs_require_consent before insert or update of request_id, kind on public.ghl_sync_jobs
  for each row execute function app_private.ghl_sync_jobs_require_consent();

-- RLS enabled and forced (S0 SEC-1); explicit grants (S0 SEC-17).
alter table public.ghl_sync_jobs enable row level security;
alter table public.ghl_sync_jobs force row level security;
revoke all on table public.ghl_sync_jobs from anon, authenticated, service_role;
grant select on table public.ghl_sync_jobs to authenticated;
grant select, insert, update, delete on table public.ghl_sync_jobs to service_role;

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
-- drop function if exists app_private.ghl_sync_jobs_require_consent();
-- commit;
