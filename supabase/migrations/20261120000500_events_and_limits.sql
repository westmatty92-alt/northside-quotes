-- 20261120000500_events_and_limits.sql
-- Purpose: the analytics events table (metrics spec destination, FR-21), the per-address
--          submission counter (FR-8, US-003), the cap on spam refusal events (FR-8, S0 SEC-14,
--          AC-003.7, AC-003.8), and the sign-in failure counters per email AND per network
--          address with their pauses (FR-9 as changed by ruling 4A, US-004, AC-004.5, AC-004.11
--          to AC-004.13). The counters store HMACs only, never a raw network address or email,
--          and live in the database so every server instance sees the same counts.
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
  created_at timestamptz not null default now(),
  -- Only the property names in docs/metrics-spec.md's event inventory, so a server bug cannot
  -- store personal data under a new key (S0 SEC-9). A new property is an additive migration.
  -- PRD v1.2: marketing_consent (quote_request_submitted) and count (spam_submission_blocked).
  constraint events_properties_allowed_keys check (
    properties - array['request_id', 'urgency', 'photo_count', 'minutes_since_submit', 'from_status',
                       'to_status', 'user_id', 'attempt_number', 'error_class', 'reason',
                       'photo_index', 'marketing_consent', 'count']::text[] = '{}'::jsonb)
);

-- Query: metrics by event name over a window (primary metric, guardrails, leading indicators).
create index if not exists events_name_created_idx on public.events (name, created_at);

-- Query: a request's events (first quote time); also covers the cascade from quote_requests.
create index if not exists events_request_idx on public.events (request_id) where request_id is not null;

-- RLS enabled and forced (S0 SEC-1); explicit grants (S0 SEC-17).
alter table public.events enable row level security;
alter table public.events force row level security;
revoke all on table public.events from anon, authenticated, service_role;
grant select on table public.events to authenticated;
grant select, insert on table public.events to service_role;
-- The only update ever made to an event: public.record_spam_refusal() raises the `count` of the
-- open spam_submission_blocked event of an address and reason (FR-8, SEC-14). Column-level, so
-- no name, time or request link can be rewritten.
grant update (properties) on table public.events to service_role;

-- Readable by the two signed-in staff (metrics spec, Destinations); written only by the server
-- and the RPCs.
drop policy if exists events_select_staff on public.events;
create policy events_select_staff on public.events
  for select to authenticated
  using ((select app_private.is_staff()));

create table if not exists public.rate_limit_hits (
  id         uuid primary key default gen_random_uuid(),
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 of 'ip|v1|<IPv4, or IPv6 /64 prefix>' with APP_SIGNING_SECRET (S0 SEC-3, SEC-19)
  created_at timestamptz not null default now()               -- rows older than 24 hours are purged daily
);

-- Query: accepted submissions from one address in the last 10 minutes (FR-8). Counted and
-- recorded only by public.take_submission_slot() under a per-address advisory lock (S0 SEC-3).
create index if not exists rate_limit_hits_ip_created_idx on public.rate_limit_hits (ip_hash, created_at desc);

alter table public.rate_limit_hits enable row level security;
alter table public.rate_limit_hits force row level security;
revoke all on table public.rate_limit_hits from anon, authenticated, service_role;
grant select, insert, delete on table public.rate_limit_hits to service_role;

-- Server only (service role). The restrictive policy states the intent: no client role ever
-- reads or writes this table.
drop policy if exists rate_limit_hits_no_client_access on public.rate_limit_hits;
create policy rate_limit_hits_no_client_access on public.rate_limit_hits
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- Spam refusal event cap (FR-8, S0 SEC-14). One row per network address and reason per 10-minute
-- window: it points at the single spam_submission_blocked event of that window and counts every
-- refusal in it. The address key lives here and never in events (metrics spec, Privacy). Once
-- 1,000 events exist for the Hamilton day, nothing is written at all, so a flood from many
-- addresses cannot grow this table past about 1,000 rows a day either.
create table if not exists public.spam_refusal_windows (
  id           uuid primary key default gen_random_uuid(),
  ip_hash      text not null check (ip_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 of 'ip|v1|<IPv4, IPv6 /64 prefix, or the word unknown>' (SECURITY_MODEL "Network address")
  reason       text not null check (reason in ('honeypot', 'too_fast', 'rate_limited')),
  window_start timestamptz not null default now(),               -- the window is [window_start, window_start + 10 minutes)
  refusals     integer not null default 1 check (refusals >= 1),  -- mirrors the event's count property
  event_id     uuid not null references public.events (id) on delete cascade,  -- cascade: the window means nothing without its event
  created_at   timestamptz not null default now()                 -- rows older than 24 hours are purged daily
);

-- Query: the open window of one address and reason (record_spam_refusal, under a lock per key).
create index if not exists spam_refusal_windows_key_idx
  on public.spam_refusal_windows (ip_hash, reason, window_start desc);
-- Covers the foreign key (cascade from events).
create index if not exists spam_refusal_windows_event_idx on public.spam_refusal_windows (event_id);

alter table public.spam_refusal_windows enable row level security;
alter table public.spam_refusal_windows force row level security;
revoke all on table public.spam_refusal_windows from anon, authenticated, service_role;
grant select, insert, update, delete on table public.spam_refusal_windows to service_role;

drop policy if exists spam_refusal_windows_no_client_access on public.spam_refusal_windows;
create policy spam_refusal_windows_no_client_access on public.spam_refusal_windows
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create table if not exists public.sign_in_attempts (
  id         uuid primary key default gen_random_uuid(),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 of 'email|v1|<lower-cased trimmed email>' with APP_SIGNING_SECRET (S0 SEC-19); an email with no account is hashed and counted the same way (AC-004.12)
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),     -- HMAC-SHA256 of 'ip|v1|<IPv4, IPv6 /64 prefix, or the word unknown>' (ruling 4A)
  succeeded  boolean not null,                                    -- written as false BEFORE Supabase Auth is called, flipped to true on a staff sign-in (S0 SEC-3)
  created_at timestamptz not null default now()                   -- rows older than 24 hours are purged daily
);

-- Query: failed attempts for one email in the last 15 minutes since its last pause ended (FR-9:
-- 5 → 5-minute pause). Counted and recorded only by public.take_sign_in_attempt() under a
-- per-email advisory lock (S0 SEC-3).
create index if not exists sign_in_attempts_email_created_idx on public.sign_in_attempts (email_hash, created_at desc);

-- Query: failed attempts from one network address in the last 15 minutes since its last pause
-- ended (FR-9: 20 → 15-minute pause, ruling 4A), under a per-address advisory lock.
create index if not exists sign_in_attempts_ip_created_idx on public.sign_in_attempts (ip_hash, created_at desc);

alter table public.sign_in_attempts enable row level security;
alter table public.sign_in_attempts force row level security;
revoke all on table public.sign_in_attempts from anon, authenticated, service_role;
grant select, insert, update, delete on table public.sign_in_attempts to service_role;

drop policy if exists sign_in_attempts_no_client_access on public.sign_in_attempts;
create policy sign_in_attempts_no_client_access on public.sign_in_attempts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- Sign-in pauses (FR-9, ruling 4A). One row each time a limit is reached: 5 failures for an
-- email within 15 minutes → that email paused 5 minutes; 20 failures from an address within 15
-- minutes → that address paused 15 minutes. paused_until also restarts the count: only failures
-- at or after the latest paused_until of that key are counted again. Written only by
-- app_private.sign_in_pause_until(), called from public.take_sign_in_attempt().
create table if not exists public.sign_in_pauses (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('email', 'ip')),
  key_hash     text not null check (key_hash ~ '^[0-9a-f]{64}$'),  -- the email_hash or ip_hash of sign_in_attempts
  paused_until timestamptz not null,
  created_at   timestamptz not null default now()                  -- rows older than 24 hours are purged daily
);

-- Query: the latest pause of one email or address (active pause, and where its count restarts).
create index if not exists sign_in_pauses_key_idx on public.sign_in_pauses (scope, key_hash, paused_until desc);

alter table public.sign_in_pauses enable row level security;
alter table public.sign_in_pauses force row level security;
revoke all on table public.sign_in_pauses from anon, authenticated, service_role;
grant select, insert, delete on table public.sign_in_pauses to service_role;

drop policy if exists sign_in_pauses_no_client_access on public.sign_in_pauses;
create policy sign_in_pauses_no_client_access on public.sign_in_pauses
  as restrictive for all to anon, authenticated
  using (false) with check (false);

commit;

-- rollback
-- begin;
-- drop table if exists public.sign_in_pauses;     -- DESTRUCTIVE: active sign-in pauses (at most 15 minutes of effect)
-- drop table if exists public.spam_refusal_windows;  -- DESTRUCTIVE: spam event windows (24 h of data)
-- drop table if exists public.sign_in_attempts;   -- DESTRUCTIVE: sign-in counters (24 h of data)
-- drop table if exists public.rate_limit_hits;    -- DESTRUCTIVE: rate-limit counters (24 h of data)
-- drop table if exists public.events;             -- DESTRUCTIVE: every analytics event
-- commit;
