-- 20261120000300_quote_requests.sql
-- Purpose: quote requests (pending until every photo is stored, then submitted with an NQ-
--          reference), their photos, and the append-only status history.
--          FR-1, FR-2, FR-3, FR-6, FR-10, FR-11, FR-12, FR-13, FR-20 · US-001, US-002, US-005,
--          US-006, US-007, US-008, US-015, US-016.
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md,
--           docs/decisions/0003-staff-auth-sessions-and-writes.md

begin;

-- NQ- plus 6 characters from A-Z without I, L, O and 2-9 (31 characters), never sequential (FR-2).
create or replace function app_private.new_reference() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := 'NQ-';
  b integer;
begin
  while char_length(result) < 9 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    -- 248 = 8 x 31: rejection sampling keeps every character equally likely
    if b < 248 then
      result := result || substr(alphabet, (b % 31) + 1, 1);
    end if;
  end loop;
  return result;
end
$$;
revoke all on function app_private.new_reference() from public;

create table if not exists public.quote_requests (
  id                   uuid primary key default gen_random_uuid(),
  submission_key       uuid not null unique,                 -- nonce of the signed form token: a double submit or retry is the same request (AC-001.6); concurrent creates are serialised in start_quote_request() and this unique index is the backstop (S0 SEC-2)
  state                text not null default 'pending' check (state in ('pending', 'submitted')),
  reference            text unique check (reference ~ '^NQ-[A-HJKMNP-Z2-9]{6}$'),
  name                 text not null check (char_length(name) between 2 and 100),
  phone                text not null check (phone ~ '^[0-9]{10}$'),   -- 10 digits after removing spaces, dashes, brackets and a leading +1
  email                text not null check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  address              text not null check (char_length(address) between 5 and 200),
  problem              text not null check (char_length(problem) between 10 and 2000),
  urgency              text not null check (urgency in ('emergency', 'soon', 'flexible')),
  photo_count          smallint not null default 0 check (photo_count between 0 and 3),  -- planned while pending, stored once submitted
  status               text not null default 'new' check (status in ('new', 'quoted', 'won', 'lost')),
  status_changed_at    timestamptz,                          -- time of the last real status change; null until the first one (FR-13)
  price_cents          bigint check (price_cents between 1 and 9999999),  -- CAD 0.01 to 99,999.99, integer cents (FR-11)
  currency             text not null default 'CAD' check (currency = 'CAD'),
  note                 text check (char_length(note) between 1 and 1000),
  first_quoted_at      timestamptz,                          -- first time a price was saved (quote_request_quoted, primary metric)
  version              integer not null default 1 check (version >= 1),  -- optimistic concurrency for staff saves (AC-006.5, AC-016.12)
  last_staff_update_at timestamptz,
  last_staff_update_by uuid references public.staff (user_id) on delete set null,  -- set null: the request outlives a removed staff account (US-015)
  ghl_contact_id       text check (ghl_contact_id ~ '^[A-Za-z0-9_-]{1,100}$'),  -- link key to the GHL contact; URL-safe characters only because it goes into /contacts/{id}/tags paths (S0 SEC-12)
  created_at           timestamptz not null default now(),
  submitted_at         timestamptz,                          -- when the request and all its photos were stored; inbox order and weekly count
  updated_at           timestamptz not null default now(),
  constraint quote_requests_submitted_has_reference
    check (state = 'pending' or (reference is not null and submitted_at is not null))
);

-- Query: SCR-04 inbox list, newest first by submitted time, 50 per page with a keyset cursor
-- (US-005, FR-10); also the "Requests this week" range of the weekly count (US-008, FR-13).
create index if not exists quote_requests_inbox_idx
  on public.quote_requests (submitted_at desc, id desc) where state = 'submitted';

-- Query: SCR-04 status filter and the four SCR-05 board columns, newest first per status
-- (US-011, US-016, FR-16, FR-23).
create index if not exists quote_requests_status_inbox_idx
  on public.quote_requests (status, submitted_at desc, id desc) where state = 'submitted';

-- Query: weekly Won and Lost counts by the time of the last status change (US-008, FR-13).
create index if not exists quote_requests_status_changed_idx
  on public.quote_requests (status, status_changed_at) where state = 'submitted';

-- Query: daily housekeeping purges pending requests older than 24 hours (decision 0002).
create index if not exists quote_requests_pending_created_idx
  on public.quote_requests (created_at) where state = 'pending';

-- Search by reference, name or phone (US-013, Could) has no index on purpose: at about
-- 2,400 rows a year a filtered scan is a few milliseconds. Add pg_trgm only if the volume grows.
-- List, filter, search and keyset paging all go through public.list_quote_requests()
-- (20261120000600_functions.sql) with typed parameters, never a filter string (S0 SEC-13).

drop trigger if exists quote_requests_set_updated_at on public.quote_requests;
create trigger quote_requests_set_updated_at before update on public.quote_requests
  for each row execute function app_private.set_updated_at();

-- RLS enabled and forced (S0 SEC-1); explicit grants (S0 SEC-17). The service role writes through
-- the security invoker functions in 20261120000600_functions.sql and purges stale pending rows.
alter table public.quote_requests enable row level security;
alter table public.quote_requests force row level security;
revoke all on table public.quote_requests from anon, authenticated, service_role;
grant select on table public.quote_requests to authenticated;
grant select, insert, update, delete on table public.quote_requests to service_role;

-- Staff (owner and helper, identical rights) read submitted requests only; pending ones are
-- invisible until every photo is stored (FR-3). Writes go through the RPCs in
-- 20261120000600_functions.sql; the public submission is written by the server (service role).
drop policy if exists quote_requests_select_staff on public.quote_requests;
create policy quote_requests_select_staff on public.quote_requests
  for select to authenticated
  using ((select app_private.is_staff()) and state = 'submitted');
-- No insert, update or delete policy for any client role (NG-7: no deleting or editing submissions).

create table if not exists public.quote_photos (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.quote_requests (id) on delete cascade,  -- cascade: photos belong to their request; a by-hand privacy deletion removes both
  position     smallint not null check (position between 1 and 3),
  storage_path text not null unique,                       -- object name in the private quote-photos bucket
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   integer not null check (size_bytes between 1 and 5242880),  -- 5 MB = 5,242,880 bytes (FR-6)
  created_at   timestamptz not null default now(),
  constraint quote_photos_position_unique unique (request_id, position),
  constraint quote_photos_path_matches check (storage_path = request_id::text || '/photo-' || position::text)
);
-- Query: SCR-06 and SCR-08 list a request's photos in order: served by quote_photos_position_unique
-- (request_id, position), which also covers the foreign key.

alter table public.quote_photos enable row level security;
alter table public.quote_photos force row level security;
revoke all on table public.quote_photos from anon, authenticated, service_role;
grant select on table public.quote_photos to authenticated;
grant select, insert, update, delete on table public.quote_photos to service_role;

drop policy if exists quote_photos_select_staff on public.quote_photos;
create policy quote_photos_select_staff on public.quote_photos
  for select to authenticated
  using (
    (select app_private.is_staff())
    and exists (select 1 from public.quote_requests q where q.id = quote_photos.request_id and q.state = 'submitted')
  );

create table if not exists public.quote_request_status_changes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.quote_requests (id) on delete cascade,  -- cascade: history goes with its request on a by-hand privacy deletion
  from_status text not null check (from_status in ('new', 'quoted', 'won', 'lost')),
  to_status   text not null check (to_status in ('new', 'quoted', 'won', 'lost')),
  changed_by  uuid references public.staff (user_id) on delete set null,  -- set null: keep the change if a staff account is removed
  changed_at  timestamptz not null default now(),
  constraint quote_request_status_changes_real check (from_status <> to_status)  -- same status again is not a change (AC-007.4)
);

-- Query: a request's status history, newest first (AC-007.7 audit, US-015); covers the foreign key.
create index if not exists quote_request_status_changes_request_idx
  on public.quote_request_status_changes (request_id, changed_at desc);

alter table public.quote_request_status_changes enable row level security;
alter table public.quote_request_status_changes force row level security;
revoke all on table public.quote_request_status_changes from anon, authenticated, service_role;
grant select on table public.quote_request_status_changes to authenticated;
grant select on table public.quote_request_status_changes to service_role;

-- Append-only audit: staff read, nobody updates or deletes; rows are written only by
-- change_quote_request_status().
drop policy if exists quote_request_status_changes_select_staff on public.quote_request_status_changes;
create policy quote_request_status_changes_select_staff on public.quote_request_status_changes
  for select to authenticated
  using ((select app_private.is_staff()));

commit;

-- rollback
-- begin;
-- drop table if exists public.quote_request_status_changes;   -- DESTRUCTIVE: status history
-- drop table if exists public.quote_photos;                   -- DESTRUCTIVE: photo rows (files stay in Storage until purged through the Storage API)
-- drop table if exists public.quote_requests;                 -- DESTRUCTIVE: every quote request
-- drop function if exists app_private.new_reference();
-- commit;
