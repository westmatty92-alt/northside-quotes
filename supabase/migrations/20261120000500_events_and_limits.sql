-- 20261120000500_events_and_limits.sql
-- Purpose: the analytics events table (metrics spec destination, FR-21), the per-address
--          submission counter (FR-8, US-003) and the per-email sign-in failure counter (FR-9,
--          US-004). The counters store HMACs only, never a raw network address or email.
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md,
--           docs/decisions/0003-staff-auth-sessions-and-writes.md

begin;

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name in (
               'quote_request_submitted', 'quote_request_quoted', 'quote_request_status_changed',
               'photo_upload_failed', 'spam_submission_blocked',
               'ghl_sync_succeeded', 'ghl_sync_attempt_failed', 'ghl_sync_gave_up',
               'ghl_tag_sync_succeeded', 'ghl_tag_sync_attempt_failed', 'ghl_tag_sync_gave_up',
               'staff_signed_in')),
  request_id uuid references public.quote_requests (id) on delete cascade,  -- cascade: events follow their request's retention (metrics spec, OQ-10); null for refusals
  user_id    uuid references auth.users (id) on delete set null,          -- set null: counts survive a removed staff account
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),  -- ids and enums only, never personal data
  created_at timestamptz not null default now()
);

-- Query: metrics by event name over a window (primary metric, guardrails, leading indicators).
create index if not exists events_name_created_idx on public.events (name, created_at);

-- Query: a request's events (first quote time); also covers the cascade from quote_requests.
create index if not exists events_request_idx on public.events (request_id) where request_id is not null;

alter table public.events enable row level security;
revoke all on table public.events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.events from authenticated;

-- Readable by the two signed-in staff (metrics spec, Destinations); written only by the server
-- and the RPCs.
drop policy if exists events_select_staff on public.events;
create policy events_select_staff on public.events
  for select to authenticated
  using ((select app_private.is_staff()));

create table if not exists public.rate_limit_hits (
  id         uuid primary key default gen_random_uuid(),
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 of the network address with APP_SIGNING_SECRET
  created_at timestamptz not null default now()               -- rows older than 24 hours are purged daily
);

-- Query: accepted submissions from one address in the last 10 minutes (FR-8).
create index if not exists rate_limit_hits_ip_created_idx on public.rate_limit_hits (ip_hash, created_at desc);

alter table public.rate_limit_hits enable row level security;
revoke all on table public.rate_limit_hits from anon, authenticated;

-- Server only (service role). The restrictive policy states the intent: no client role ever
-- reads or writes this table.
drop policy if exists rate_limit_hits_no_client_access on public.rate_limit_hits;
create policy rate_limit_hits_no_client_access on public.rate_limit_hits
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create table if not exists public.sign_in_attempts (
  id         uuid primary key default gen_random_uuid(),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 of the lower-cased email with APP_SIGNING_SECRET
  succeeded  boolean not null,
  created_at timestamptz not null default now()                   -- rows older than 24 hours are purged daily
);

-- Query: failed attempts for one email in the last 15 minutes (FR-9 pause after 5).
create index if not exists sign_in_attempts_email_created_idx on public.sign_in_attempts (email_hash, created_at desc);

alter table public.sign_in_attempts enable row level security;
revoke all on table public.sign_in_attempts from anon, authenticated;

drop policy if exists sign_in_attempts_no_client_access on public.sign_in_attempts;
create policy sign_in_attempts_no_client_access on public.sign_in_attempts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

commit;

-- rollback
-- begin;
-- drop table if exists public.sign_in_attempts;   -- DESTRUCTIVE: sign-in counters (24 h of data)
-- drop table if exists public.rate_limit_hits;    -- DESTRUCTIVE: rate-limit counters (24 h of data)
-- drop table if exists public.events;             -- DESTRUCTIVE: every analytics event
-- commit;
