-- 20261120000600_functions.sql
-- Purpose: the only write paths for quote requests, each one transaction:
--   start_quote_request         service role  create or replay a pending request for one form token, with the rate limit and the offers choice (FR-3, FR-8, FR-25, S0 SEC-2, SEC-3)
--   take_submission_slot        service role  lock, count and record one accepted submission per address (FR-8, S0 SEC-3)
--   record_spam_refusal         service role  one spam_submission_blocked event per address and reason per 10 minutes with a count, 1,000 a day (FR-8, S0 SEC-14)
--   take_sign_in_attempt / mark_sign_in_succeeded  service role  sign-in limits per email and per address, atomic (FR-9, ruling 4A, S0 SEC-3)
--   complete_quote_request      service role  pending -> submitted, NQ- reference, photo rows, consent time, copy job only with consent, event (FR-2, FR-3, FR-15, FR-25)
--   save_quote_request_quote    staff         price + note with version check, first-quote event (FR-11, US-006)
--   change_quote_request_status staff         status + audit row + new stage-tag job only with consent + event (FR-12, FR-24, US-007, US-016)
--   request_ghl_copy_retry      staff         re-arm a failed contact copy for one manual attempt; never without consent (FR-19, US-014, AC-014.4)
--   claim_ghl_job / finish_ghl_job service role  lease ONE job, settle it only with that lease (FR-15, FR-24, US-010, S0 SEC-7)
--   find_ghl_contact_match      service role  the contact match rule: same email or same phone, already linked (FR-15, ruling 2A)
--   ghl_stage_for_request       service role  the stage tag a contact must carry: last change wins among its requests (FR-24, ruling 2A)
--   list_quote_requests         staff         Requests tab list, status filter, search, Pipeline columns, keyset paging with typed parameters (US-005, US-011, US-013, US-016, S0 SEC-13)
--   weekly_counts               staff         this week's three numbers, Monday to Sunday America/Toronto (FR-13, US-008)
--
-- Security definer or invoker (S0 SEC-1, forced RLS):
--   * Every service-role function is SECURITY INVOKER. It runs as service_role, which has
--     BYPASSRLS on Supabase, so it never depends on the table owner's attributes, and if it were
--     ever granted to another role by mistake, RLS would still stop it.
--   * The three staff write RPCs (and app_private.is_staff, current_staff, photo_upload_allowed)
--     are SECURITY DEFINER because authenticated has select only. They run as postgres, which has
--     BYPASSRLS on Supabase (asserted in supabase/tests/rls/all_tables.sql). Without it they fail
--     closed (error or no rows), never open.
--   * Every function sets search_path = '' and qualifies every name.
--
-- Errors use PostgREST custom SQLSTATEs so route handlers can map them:
--   PT401 no fresh staff session · PT404 not found · PT409 changed by someone else / not retryable · PT422 invalid input
-- Route handlers map these codes (and 23505/23514) to problem responses built from our own text,
-- never from the database message, details or hint (S0 SEC-5, docs/SECURITY_MODEL.md invariant 11).
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md,
--           docs/decisions/0003-staff-auth-sessions-and-writes.md,
--           docs/decisions/0004-ghl-sync-and-retry-schedule.md

begin;

-- complete_quote_request (security invoker, service role) calls this to draw a reference.
grant execute on function app_private.new_reference() to service_role;

-- ---------------------------------------------------------------------------------------------
-- take_submission_slot: FR-8's "5 accepted submissions per address per 10 minutes" as ONE call.
-- The advisory lock serialises every call for one address hash, so N parallel creates cannot all
-- read the count before any of them records (S0 SEC-3). The caller hashes 'ip|v1|<address>',
-- with an IPv6 address cut to its /64 prefix first (docs/SECURITY_MODEL.md).
create or replace function public.take_submission_slot(
  p_ip_hash text, p_limit integer default 5, p_window interval default interval '10 minutes')
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('submission_slot:' || p_ip_hash, 0));
  if (select count(*) from public.rate_limit_hits
       where ip_hash = p_ip_hash and created_at > now() - p_window) >= p_limit then
    return false;
  end if;
  insert into public.rate_limit_hits (ip_hash) values (p_ip_hash);
  return true;
end
$$;
revoke all on function public.take_submission_slot(text, integer, interval) from public, anon, authenticated;
grant execute on function public.take_submission_slot(text, integer, interval) to service_role;

-- ---------------------------------------------------------------------------------------------
-- start_quote_request: POST /api/quote-requests after the token, honeypot and zod checks.
-- One call per create; every call for one form token is serialised by an advisory lock, so two
-- concurrent creates with the same token resolve to ONE request (S0 SEC-2). The offers choice
-- (FR-25) is compared like every other field: the route passes true only for a JSON true and
-- false for anything else (missing, "yes", "maybe", 1, null); null here is stored as false too.
-- Outcomes:
--   created       new pending request (201); took a rate-limit slot
--   replayed      same token, same fields: the existing request, pending or submitted (200)
--   updated       same token, changed fields, still pending: updated; the route clears the
--                 uploaded photos so they are uploaded again (200)
--   token_used    same token, changed fields, already submitted: nothing changes (409
--                 form_already_used; the page gets a fresh token and keeps what was typed)
--   rate_limited  a new request from an address with 5 accepted in 10 minutes (429)
-- p_ip_hash null (no address) or a failing counter accepts the request (AC-003.5).
create or replace function public.start_quote_request(
  p_submission_key uuid,
  p_name           text,
  p_phone          text,
  p_email          text,
  p_address        text,
  p_problem        text,
  p_urgency        text,
  p_photo_count    integer,
  p_ip_hash        text,
  p_marketing_consent boolean default false)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_req     public.quote_requests%rowtype;
  v_slot    boolean;
  v_retry   integer;
  v_consent boolean := coalesce(p_marketing_consent, false);  -- AC-001.17: anything but a clear yes is no
begin
  if p_submission_key is null then
    raise exception 'form token nonce required' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quote_submission:' || p_submission_key::text, 0));

  select * into v_req from public.quote_requests where submission_key = p_submission_key for update;

  if found then
    if (v_req.name, v_req.phone, v_req.email, v_req.address, v_req.problem, v_req.urgency,
        v_req.photo_count::integer, v_req.marketing_consent)
       is not distinct from (p_name, p_phone, p_email, p_address, p_problem, p_urgency, p_photo_count,
                             v_consent) then
      return jsonb_build_object('outcome', 'replayed', 'request_id', v_req.id, 'state', v_req.state,
                                'reference', v_req.reference, 'photo_count', v_req.photo_count,
                                'created_at', v_req.created_at);
    end if;

    if v_req.state = 'submitted' then
      return jsonb_build_object('outcome', 'token_used');
    end if;

    update public.quote_requests
       set name = p_name, phone = p_phone, email = p_email, address = p_address,
           problem = p_problem, urgency = p_urgency, photo_count = p_photo_count,
           marketing_consent = v_consent
     where id = v_req.id
    returning * into v_req;
    return jsonb_build_object('outcome', 'updated', 'request_id', v_req.id, 'state', v_req.state,
                              'reference', null, 'photo_count', v_req.photo_count,
                              'created_at', v_req.created_at);
  end if;

  if p_ip_hash is not null then
    begin
      v_slot := public.take_submission_slot(p_ip_hash);
    exception when others then
      v_slot := true;  -- AC-003.5: a counter that cannot be used never blocks a homeowner
    end;
    if not v_slot then
      -- seconds until the oldest of the 5 most recent accepted submissions leaves the window
      select greatest(1, ceil(extract(epoch from (min(h.created_at) + interval '10 minutes' - now())))::integer)
        into v_retry
        from (select r.created_at from public.rate_limit_hits r
               where r.ip_hash = p_ip_hash and r.created_at > now() - interval '10 minutes'
               order by r.created_at desc
               limit 5) h;
      return jsonb_build_object('outcome', 'rate_limited', 'retry_after_seconds', coalesce(v_retry, 600));
    end if;
  end if;

  insert into public.quote_requests (submission_key, name, phone, email, address, problem, urgency, photo_count,
                                     marketing_consent)
  values (p_submission_key, p_name, p_phone, p_email, p_address, p_problem, p_urgency, p_photo_count,
          v_consent)
  returning * into v_req;

  return jsonb_build_object('outcome', 'created', 'request_id', v_req.id, 'state', v_req.state,
                            'reference', null, 'photo_count', v_req.photo_count,
                            'created_at', v_req.created_at);
end
$$;
revoke all on function public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- record_spam_refusal: the route calls this after refusing a submission for the honeypot, the
-- 3-second minimum or the rate limit (FR-8, S0 SEC-14, AC-003.7, AC-003.8). At most ONE
-- spam_submission_blocked event per address and reason per 10-minute window: the first refusal
-- writes the event with count 1 and opens the window; later refusals in the window only raise
-- that event's count. A new event is written only while fewer than 1,000 exist for the current
-- Hamilton (America/Toronto) day; past that cap nothing is written at all. The refusal itself is
-- answered the same way in every case; this function only decides what is logged. The caller
-- hashes 'ip|v1|<address>' (IPv6 /64), or 'ip|v1|unknown' when no address is known. If this call
-- fails, the route still refuses exactly the same way and logs nothing (fails open for logging).
-- Returns {logged: boolean, event_id, count}.
create or replace function public.record_spam_refusal(p_ip_hash text, p_reason text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window public.spam_refusal_windows%rowtype;
  v_event  uuid;
  v_today  timestamptz := date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto';
begin
  if p_ip_hash is null or p_reason is null or p_reason not in ('honeypot', 'too_fast', 'rate_limited') then
    raise exception 'address hash and a known reason required' using errcode = 'PT422';
  end if;

  -- one key at a time: two refusals from one address and reason never open two windows
  perform pg_advisory_xact_lock(hashtextextended('spam_refusal:' || p_ip_hash || ':' || p_reason, 0));

  select * into v_window from public.spam_refusal_windows w
   where w.ip_hash = p_ip_hash and w.reason = p_reason and w.window_start > now() - interval '10 minutes'
   order by w.window_start desc
   limit 1
   for update;

  if found then
    update public.spam_refusal_windows set refusals = refusals + 1 where id = v_window.id
    returning * into v_window;
    update public.events
       set properties = jsonb_set(properties, '{count}', to_jsonb(v_window.refusals))
     where id = v_window.event_id;
    return jsonb_build_object('logged', true, 'event_id', v_window.event_id, 'count', v_window.refusals);
  end if;

  -- a new event: the daily total is checked and written under one global lock, so the 1,000 cap
  -- is exact even when many addresses are refused at the same moment
  perform pg_advisory_xact_lock(hashtextextended('spam_refusal_day', 0));
  if (select count(*) from public.events e
       where e.name = 'spam_submission_blocked' and e.created_at >= v_today) >= 1000 then
    return jsonb_build_object('logged', false, 'event_id', null, 'count', 0);
  end if;

  insert into public.events (name, properties)
  values ('spam_submission_blocked', jsonb_build_object('reason', p_reason, 'count', 1))
  returning id into v_event;
  insert into public.spam_refusal_windows (ip_hash, reason, event_id) values (p_ip_hash, p_reason, v_event);
  return jsonb_build_object('logged', true, 'event_id', v_event, 'count', 1);
end
$$;
revoke all on function public.record_spam_refusal(text, text) from public, anon, authenticated;
grant execute on function public.record_spam_refusal(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- app_private.sign_in_pause_until: when one email ('email') or one network address ('ip') may
-- sign in again (FR-9, ruling 4A). Called only by take_sign_in_attempt, under that key's lock.
--   * The count restarts when a pause ends: only failures at or after the latest paused_until
--     of the key are counted.
--   * The limit is reached when p_limit failures fall within p_window ending at the newest
--     counted failure. Every failure is recorded by take_sign_in_attempt after this check ran,
--     so only the newest failure can have reached the limit unnoticed; the pause then runs from
--     that failure for p_pause and is recorded, even if it already ran out (so the count
--     restarts at its end, as the PRD says).
-- Returns the end of the latest pause (may be in the past) or null if the key was never paused.
create or replace function app_private.sign_in_pause_until(
  p_scope text, p_key text, p_limit integer, p_window interval, p_pause interval)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_last_end timestamptz;
  v_since    timestamptz;
  v_newest   timestamptz;
  v_n        integer;
begin
  select max(p.paused_until) into v_last_end
    from public.sign_in_pauses p
   where p.scope = p_scope and p.key_hash = p_key;
  if v_last_end > now() then
    return v_last_end;                       -- paused right now
  end if;
  v_since := coalesce(v_last_end, '-infinity'::timestamptz);

  if p_scope = 'email' then
    select max(a.created_at) into v_newest from public.sign_in_attempts a
     where a.email_hash = p_key and not a.succeeded and a.created_at >= v_since;
  else
    select max(a.created_at) into v_newest from public.sign_in_attempts a
     where a.ip_hash = p_key and not a.succeeded and a.created_at >= v_since;
  end if;
  if v_newest is null then
    return v_last_end;
  end if;

  if p_scope = 'email' then
    select count(*) into v_n from public.sign_in_attempts a
     where a.email_hash = p_key and not a.succeeded and a.created_at >= v_since
       and a.created_at > v_newest - p_window;
  else
    select count(*) into v_n from public.sign_in_attempts a
     where a.ip_hash = p_key and not a.succeeded and a.created_at >= v_since
       and a.created_at > v_newest - p_window;
  end if;
  if v_n < p_limit then
    return v_last_end;
  end if;

  insert into public.sign_in_pauses (scope, key_hash, paused_until) values (p_scope, p_key, v_newest + p_pause);
  return v_newest + p_pause;
end
$$;
revoke all on function app_private.sign_in_pause_until(text, text, integer, interval, interval) from public;
grant execute on function app_private.sign_in_pause_until(text, text, integer, interval, interval) to service_role;

-- take_sign_in_attempt: POST /api/auth/sign-in calls this BEFORE Supabase Auth (FR-9, ruling 4A,
-- S0 SEC-3). Two limits, both kept in the database so every server instance sees the same counts:
--   per email   5 failures within 15 minutes → that email is paused for 5 minutes
--   per address 20 failures within 15 minutes, across any emails → that address is paused for
--               15 minutes (an IPv6 address counts by its /64; no address → the 'unknown' key)
-- Each count restarts when its pause ends. Under a lock on the email, then on the address (every
-- call takes them in this order, so two calls never deadlock), it either refuses (refused
-- attempts are not counted) or records the attempt as a failure up front and returns its id, so
-- parallel guesses count against each other. An email with no account is just another hash and
-- is counted and paused the same way (AC-004.12). The route calls mark_sign_in_succeeded() only
-- when the user is signed in AND is staff; a success is not a failure. Any error here (counters
-- unreadable) must make the route refuse sign-in with 503 sign_in_unavailable (AC-004.13): this
-- function never swallows an error. retry_after_seconds is for tests and the server only: the
-- route must not send it, because 5 vs 15 minutes would say which limit applied.
-- Returns {allowed, attempt_id, retry_after_seconds}.
create or replace function public.take_sign_in_attempt(p_email_hash text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_until timestamptz;
  v_id    uuid;
begin
  if p_email_hash is null or p_ip_hash is null then
    raise exception 'email and address hashes required' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sign_in_email:' || p_email_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('sign_in_ip:' || p_ip_hash, 0));

  -- greatest() ignores nulls: the later of the two pause ends decides
  v_until := greatest(
    app_private.sign_in_pause_until('email', p_email_hash, 5, interval '15 minutes', interval '5 minutes'),
    app_private.sign_in_pause_until('ip', p_ip_hash, 20, interval '15 minutes', interval '15 minutes'));

  if v_until is not null and v_until > now() then
    return jsonb_build_object(
      'allowed', false, 'attempt_id', null,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_until - now())))::integer));
  end if;

  insert into public.sign_in_attempts (email_hash, ip_hash, succeeded) values (p_email_hash, p_ip_hash, false)
  returning id into v_id;
  return jsonb_build_object('allowed', true, 'attempt_id', v_id, 'retry_after_seconds', 0);
end
$$;
revoke all on function public.take_sign_in_attempt(text, text) from public, anon, authenticated;
grant execute on function public.take_sign_in_attempt(text, text) to service_role;

create or replace function public.mark_sign_in_succeeded(p_attempt_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  with u as (
    update public.sign_in_attempts set succeeded = true where id = p_attempt_id returning 1
  )
  select exists (select 1 from u);
$$;
revoke all on function public.mark_sign_in_succeeded(uuid) from public, anon, authenticated;
grant execute on function public.mark_sign_in_succeeded(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- complete_quote_request: called by POST /api/quote-requests/{id}/submission after the server
-- has checked every uploaded photo. p_photos = [{position, storage_path, content_type, size_bytes}].
-- Calling it again for a submitted request returns the same reference (double submit, AC-001.6).
-- Ruling 1B (FR-15, FR-25): a ticked request gets its consent time (= the time it is stored) and
-- ONE contact_copy job; an unticked request gets no job at all, so nothing ever reaches GHL for
-- it (AC-009.9). The request is stored and confirmed the same way in both cases.
create or replace function public.complete_quote_request(p_request_id uuid, p_photos jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_req    public.quote_requests%rowtype;
  v_ref    text;
  v_tries  integer := 0;
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
begin
  select * into v_req from public.quote_requests where id = p_request_id for update;
  if not found then
    raise exception 'quote request not found' using errcode = 'PT404';
  end if;

  if v_req.state = 'submitted' then
    return jsonb_build_object('request_id', v_req.id, 'reference', v_req.reference,
                              'submitted_at', v_req.submitted_at, 'photo_count', v_req.photo_count,
                              'replayed', true);
  end if;

  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) <> v_req.photo_count then
    raise exception 'photos do not match the planned photo count' using errcode = 'PT422';
  end if;

  insert into public.quote_photos (request_id, position, storage_path, content_type, size_bytes)
  select p_request_id,
         (p ->> 'position')::smallint,
         p ->> 'storage_path',
         p ->> 'content_type',
         (p ->> 'size_bytes')::integer
  from jsonb_array_elements(v_photos) as p;

  loop
    v_ref := app_private.new_reference();
    begin
      update public.quote_requests
         set state = 'submitted', reference = v_ref, submitted_at = now(),
             marketing_consent_at = case when marketing_consent then now() end
       where id = p_request_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 5 then
        raise;
      end if;
    end;
  end loop;

  if v_req.marketing_consent then
    insert into public.ghl_sync_jobs (request_id, kind) values (p_request_id, 'contact_copy');
  end if;

  insert into public.events (name, request_id, properties)
  values ('quote_request_submitted', p_request_id,
          jsonb_build_object('request_id', p_request_id, 'urgency', v_req.urgency,
                             'photo_count', v_req.photo_count,
                             'marketing_consent', v_req.marketing_consent));

  return jsonb_build_object('request_id', p_request_id, 'reference', v_ref, 'submitted_at', now(),
                            'photo_count', v_req.photo_count, 'replayed', false);
end
$$;
revoke all on function public.complete_quote_request(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_quote_request(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- save_quote_request_quote: PUT /api/quote-requests/{id}/quote. A blank price or note clears it.
create or replace function public.save_quote_request_quote(
  p_request_id uuid, p_price_cents bigint, p_note text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.quote_requests%rowtype;
  v_uid   uuid := auth.uid();
  v_note  text := nullif(p_note, '');
  v_first boolean;
begin
  if not app_private.is_staff() then
    raise exception 'staff session required' using errcode = 'PT401';
  end if;
  if p_price_cents is not null and (p_price_cents < 1 or p_price_cents > 9999999) then
    raise exception 'price must be from 0.01 to 99,999.99' using errcode = 'PT422';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note must be at most 1,000 characters' using errcode = 'PT422';
  end if;

  select * into v_req from public.quote_requests
   where id = p_request_id and state = 'submitted' for update;
  if not found then
    raise exception 'quote request not found' using errcode = 'PT404';
  end if;
  if p_expected_version is null or v_req.version <> p_expected_version then
    raise exception 'changed by someone else' using errcode = 'PT409';
  end if;

  v_first := v_req.first_quoted_at is null and p_price_cents is not null;

  update public.quote_requests
     set price_cents = p_price_cents,
         note = v_note,
         version = version + 1,
         first_quoted_at = case when v_first then now() else first_quoted_at end,
         last_staff_update_at = now(),
         last_staff_update_by = v_uid
   where id = p_request_id
  returning * into v_req;

  if v_first then
    insert into public.events (name, request_id, user_id, properties)
    values ('quote_request_quoted', p_request_id, v_uid,
            jsonb_build_object('request_id', p_request_id,
                               'minutes_since_submit',
                               floor(extract(epoch from (now() - v_req.submitted_at)) / 60)::integer));
  end if;

  return jsonb_build_object('price_cents', v_req.price_cents, 'note', v_req.note,
                            'version', v_req.version, 'first_quote', v_first);
end
$$;
revoke all on function public.save_quote_request_quote(uuid, bigint, text, integer) from public, anon;
grant execute on function public.save_quote_request_quote(uuid, bigint, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- change_quote_request_status: POST /api/quote-requests/{id}/status-changes (Requests tab and
-- Pipeline tab). Same status again changes nothing (AC-007.4, AC-016.6). A real change of a
-- ticked request supersedes any active stage-tag push and starts a new one (FR-24); a real
-- change of an unticked request queues nothing and makes no GHL call (ruling 1B, AC-017.16).
create or replace function public.change_quote_request_status(
  p_request_id uuid, p_to_status text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req  public.quote_requests%rowtype;
  v_from text;
  v_uid  uuid := auth.uid();
begin
  if not app_private.is_staff() then
    raise exception 'staff session required' using errcode = 'PT401';
  end if;
  if p_to_status is null or p_to_status not in ('new', 'quoted', 'won', 'lost') then
    raise exception 'unknown status' using errcode = 'PT422';
  end if;

  select * into v_req from public.quote_requests
   where id = p_request_id and state = 'submitted' for update;
  if not found then
    raise exception 'quote request not found' using errcode = 'PT404';
  end if;
  if p_expected_version is null or v_req.version <> p_expected_version then
    raise exception 'changed by someone else' using errcode = 'PT409';
  end if;

  if v_req.status = p_to_status then
    return jsonb_build_object('changed', false, 'status', v_req.status,
                              'status_changed_at', v_req.status_changed_at, 'version', v_req.version);
  end if;

  v_from := v_req.status;

  update public.quote_requests
     set status = p_to_status,
         status_changed_at = now(),
         version = version + 1,
         last_staff_update_at = now(),
         last_staff_update_by = v_uid
   where id = p_request_id
  returning * into v_req;

  insert into public.quote_request_status_changes (request_id, from_status, to_status, changed_by)
  values (p_request_id, v_from, p_to_status, v_uid);

  if v_req.marketing_consent then
    -- Superseding also drops the lease, so a runner still working on the old push cannot settle it.
    update public.ghl_sync_jobs
       set state = 'superseded', locked_until = null, lease_id = null
     where request_id = p_request_id and kind = 'stage_tag' and state in ('pending', 'waiting');

    insert into public.ghl_sync_jobs (request_id, kind, target_status)
    values (p_request_id, 'stage_tag', p_to_status);
  end if;

  insert into public.events (name, request_id, user_id, properties)
  values ('quote_request_status_changed', p_request_id, v_uid,
          jsonb_build_object('request_id', p_request_id, 'from_status', v_from,
                             'to_status', p_to_status, 'user_id', v_uid));

  return jsonb_build_object('changed', true, 'status', v_req.status,
                            'status_changed_at', v_req.status_changed_at, 'version', v_req.version);
end
$$;
revoke all on function public.change_quote_request_status(uuid, text, integer) from public, anon;
grant execute on function public.change_quote_request_status(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- request_ghl_copy_retry: POST /api/quote-requests/{id}/ghl-copy-retries (US-014, Could).
-- Re-arms a failed contact copy for exactly one more attempt and returns the job id; the route
-- then claims that job with claim_ghl_job(p_job_id => ...) and runs it. A second click while it
-- runs gets PT409 (AC-014.3). A request without offers consent has no job and never gets one:
-- PT409 (not_retryable), nothing is created and no GHL call is made (AC-014.4).
create or replace function public.request_ghl_copy_retry(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     uuid;
  v_consent boolean;
begin
  if not app_private.is_staff() then
    raise exception 'staff session required' using errcode = 'PT401';
  end if;
  select marketing_consent into v_consent
    from public.quote_requests where id = p_request_id and state = 'submitted';
  if not found then
    raise exception 'quote request not found' using errcode = 'PT404';
  end if;
  if not v_consent then
    raise exception 'no offers consent: this request is never copied' using errcode = 'PT409';
  end if;

  update public.ghl_sync_jobs
     set state = 'waiting', next_attempt_at = now(), max_attempts = attempt_count + 1,
         locked_until = null, lease_id = null
   where request_id = p_request_id and kind = 'contact_copy' and state = 'failed'
  returning id into v_job;

  if v_job is null then
    raise exception 'the copy is not in a failed state' using errcode = 'PT409';
  end if;
  return v_job;
end
$$;
revoke all on function public.request_ghl_copy_retry(uuid) from public, anon;
grant execute on function public.request_ghl_copy_retry(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- claim_ghl_job: lease ONE due job (optionally of one request, or one exact job) with a fresh
-- lease_id. One job per lease, so a lease never has to outlast a batch (S0 SEC-7). The lease is
-- clamped to 30..280 seconds (inside Vercel's 300 s cap); the default 120 s covers the worst
-- case of three 10-second GHL calls. A contact copy is claimed before stage tags.
create or replace function public.claim_ghl_job(
  p_request_id uuid default null, p_job_id uuid default null, p_lease_seconds integer default 120)
returns setof public.ghl_sync_jobs
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.ghl_sync_jobs j
     set locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 280))),
         lease_id = gen_random_uuid()
   where j.id = (
     select c.id
       from public.ghl_sync_jobs c
      where c.state in ('pending', 'waiting')
        and c.next_attempt_at <= now()
        and (p_request_id is null or c.request_id = p_request_id)
        and (p_job_id is null or c.id = p_job_id)
        and (c.locked_until is null or c.locked_until < now())
      order by (c.kind = 'stage_tag'), c.next_attempt_at
      limit 1
      for update skip locked
   )
  returning j.*;
$$;
revoke all on function public.claim_ghl_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ghl_job(uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- finish_ghl_job: settle one claimed job, only with the lease id its claim returned.
--   succeeded  GHL confirmed; stores the contact id and the link time for a copy (created OR linked
--              to an existing contact by the match rule, ruling 2A)
--   retry      timeout, 5xx, 429 or an unusable reply: wait and retry (5 min, 1 h, 3 h, 6 h, 12 h)
--   failed     fail now, no retries
-- The error classes auth (401/403), config_missing (no token) and rejected (GHL 400, 404, 422:
-- it refused the data or the contact no longer exists) ALWAYS fail at once, whatever outcome the
-- runner passes (AC-009.3, AC-017.10, docs/integration-contract.md "When the platform is down").
--   wait       stage tag whose contact copy has not succeeded yet: no attempt counted
--   abandon    stage tag whose contact copy failed: stage tag failed, no attempt counted (FR-24)
-- Returned unchanged (and nothing recorded) when the job was superseded or settled meanwhile, or
-- when p_lease_id is null or not the job's current lease: a runner whose lease expired and was
-- re-claimed by another runner can no longer change the job (S0 SEC-7). Every settle clears the lease.
create or replace function public.finish_ghl_job(
  p_job_id uuid, p_lease_id uuid, p_outcome text, p_error_class text default null, p_contact_id text default null)
returns public.ghl_sync_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job     public.ghl_sync_jobs%rowtype;
  v_attempt integer;
  v_prefix  text;
  v_outcome text := p_outcome;
  v_delays  constant interval[] := array[interval '5 minutes', interval '1 hour', interval '3 hours',
                                         interval '6 hours', interval '12 hours'];
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'retry', 'failed', 'wait', 'abandon') then
    raise exception 'unknown outcome' using errcode = 'PT422';
  end if;
  if p_outcome = 'retry' and p_error_class in ('auth', 'config_missing', 'rejected') then
    v_outcome := 'failed';   -- these never get better by waiting
  end if;

  select * into v_job from public.ghl_sync_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'PT404';
  end if;
  if v_job.state not in ('pending', 'waiting') then
    return v_job;
  end if;
  if p_lease_id is null or v_job.lease_id is distinct from p_lease_id then
    return v_job;
  end if;

  v_prefix := case v_job.kind when 'contact_copy' then 'ghl_sync' else 'ghl_tag_sync' end;

  if p_outcome = 'wait' then
    update public.ghl_sync_jobs
       set state = 'waiting', next_attempt_at = now() + interval '5 minutes',
           locked_until = null, lease_id = null
     where id = p_job_id
    returning * into v_job;
    return v_job;
  end if;

  if p_outcome = 'abandon' then
    update public.ghl_sync_jobs
       set state = 'failed', locked_until = null, lease_id = null
     where id = p_job_id
    returning * into v_job;
    return v_job;
  end if;

  v_attempt := v_job.attempt_count + 1;

  if p_outcome = 'succeeded' then
    update public.ghl_sync_jobs
       set state = 'succeeded', attempt_count = v_attempt, last_attempt_at = now(),
           last_error_class = null, locked_until = null, lease_id = null
     where id = p_job_id
    returning * into v_job;

    if v_job.kind = 'contact_copy' then
      if p_contact_id is not null then
        -- the check constraint refuses anything but [A-Za-z0-9_-]{1,100} (S0 SEC-12); the link time
        -- is this copy's place in "last change wins" on a shared contact (FR-24)
        update public.quote_requests set ghl_contact_id = p_contact_id, ghl_linked_at = now()
         where id = v_job.request_id;
      end if;
      -- The new contact already carries the current stage tag, so a stage tag that was abandoned
      -- because the copy had failed no longer applies.
      update public.ghl_sync_jobs
         set state = 'superseded'
       where request_id = v_job.request_id and kind = 'stage_tag' and state = 'failed' and attempt_count = 0;
    end if;

    insert into public.events (name, request_id, properties)
    values (v_prefix || '_succeeded', v_job.request_id,
            jsonb_strip_nulls(jsonb_build_object('request_id', v_job.request_id,
                                                 'to_status', v_job.target_status,
                                                 'attempt_number', v_attempt)));
    return v_job;
  end if;

  -- retry or failed: one attempt that did not work
  if p_error_class is null
     or p_error_class not in ('timeout', 'auth', 'rate_limited', 'server_error', 'config_missing', 'rejected') then
    raise exception 'unknown error class' using errcode = 'PT422';
  end if;

  insert into public.events (name, request_id, properties)
  values (v_prefix || '_attempt_failed', v_job.request_id,
          jsonb_strip_nulls(jsonb_build_object('request_id', v_job.request_id,
                                               'to_status', v_job.target_status,
                                               'attempt_number', v_attempt,
                                               'error_class', p_error_class)));

  if v_outcome = 'failed' or v_attempt >= v_job.max_attempts then
    update public.ghl_sync_jobs
       set state = 'failed', attempt_count = v_attempt, last_attempt_at = now(),
           last_error_class = p_error_class, locked_until = null, lease_id = null
     where id = p_job_id
    returning * into v_job;

    -- automatic retries ran out (not a token failure, not rejected, not a manual retry)
    if v_outcome = 'retry' and v_job.max_attempts = 6 then
      insert into public.events (name, request_id, properties)
      values (v_prefix || '_gave_up', v_job.request_id,
              jsonb_strip_nulls(jsonb_build_object('request_id', v_job.request_id,
                                                   'to_status', v_job.target_status)));
    end if;
  else
    update public.ghl_sync_jobs
       set state = 'waiting', attempt_count = v_attempt, last_attempt_at = now(),
           last_error_class = p_error_class, locked_until = null, lease_id = null,
           next_attempt_at = now() + v_delays[least(v_attempt, 5)]
     where id = p_job_id
    returning * into v_job;
  end if;

  return v_job;
end
$$;
revoke all on function public.finish_ghl_job(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_ghl_job(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- find_ghl_contact_match: step 1 of the contact copy (FR-15, ruling 2A, AC-009.10, AC-009.11).
-- The match rule: two requests belong to the same homeowner when they have the same email
-- (compared trimmed and lower-cased) OR the same 10-digit phone. Returns the GHL contact id of
-- the most recently linked OTHER consented request that matches, or null. The runner links to it
-- (adds our tags, never changes the contact's fields, OQ-19A) instead of searching GHL; with
-- null it falls back to GHL's duplicate search, then to a create. Unticked requests are never
-- linked (column check), so they are never a match (AC-009.12, AC-009.13).
create or replace function public.find_ghl_contact_match(p_request_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select m.ghl_contact_id
    from public.quote_requests r
    join public.quote_requests m
      on m.id <> r.id
     and m.ghl_contact_id is not null
     and m.marketing_consent
     and (lower(btrim(m.email)) = lower(btrim(r.email)) or m.phone = r.phone)
   where r.id = p_request_id and r.marketing_consent
   order by m.ghl_linked_at desc, m.id desc
   limit 1;
$$;
revoke all on function public.find_ghl_contact_match(uuid) from public, anon, authenticated;
grant execute on function public.find_ghl_contact_match(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- ghl_stage_for_request: the status whose stage tag the request's contact must carry now
-- (FR-24, ruling 2A, AC-017.15, AC-017.17). Among the consented requests linked to the same GHL
-- contact, the one with the most recent change wins, where a request's last change is the later
-- of its link time (its copy) and its last status change. A request not linked yet answers with
-- its own status. Every stage-tag attempt and every copy that links an existing contact applies
-- this value, so a late retry can never put back an older stage. Null for an unticked request.
create or replace function public.ghl_stage_for_request(p_request_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select s.status
       from public.quote_requests r
       join public.quote_requests s
         on s.ghl_contact_id = r.ghl_contact_id and s.marketing_consent
      where r.id = p_request_id and r.ghl_contact_id is not null
      order by greatest(s.ghl_linked_at, coalesce(s.status_changed_at, s.ghl_linked_at)) desc, s.id desc
      limit 1),
    (select r.status from public.quote_requests r where r.id = p_request_id and r.marketing_consent));
$$;
revoke all on function public.ghl_stage_for_request(uuid) from public, anon, authenticated;
grant execute on function public.ghl_stage_for_request(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- list_quote_requests: GET /api/quote-requests (the Requests tab with its status filter and search,
-- and each Pipeline tab column: one operation serves both tabs).
-- Typed parameters only, so no PostgREST filter string is ever built from q or the cursor (S0
-- SEC-13). Security invoker: RLS decides what the caller sees (fresh staff session, submitted
-- rows only). Order: submitted_at desc, id desc. Keyset: pass both p_after_* values from the last
-- row of the previous page. Ask for limit + 1 rows (max 101) to know whether a next page exists.
-- Search: reference (case-insensitive, exact), name (case-insensitive, partial), or phone digits
-- (3 or more digits, partial). Served by quote_requests_inbox_idx / quote_requests_status_inbox_idx.
create or replace function public.list_quote_requests(
  p_status             text default null,
  p_q                  text default null,
  p_after_submitted_at timestamptz default null,
  p_after_id           uuid default null,
  p_limit              integer default 51)
returns table (id uuid, reference text, name text, urgency text, status text,
               submitted_at timestamptz, version integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select nullif(btrim(coalesce(p_q, '')), '') as q,
           nullif(regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'), '') as digits
  )
  select r.id, r.reference, r.name, r.urgency, r.status, r.submitted_at, r.version
    from public.quote_requests r
   cross join params x
   where r.state = 'submitted'
     and (p_status is null or r.status = p_status)
     and ((p_after_submitted_at is null and p_after_id is null)
          or (r.submitted_at, r.id) < (p_after_submitted_at, p_after_id))
     and (x.q is null
          or r.reference = upper(x.q)
          or strpos(lower(r.name), lower(x.q)) > 0
          or (char_length(x.digits) >= 3 and strpos(r.phone, x.digits) > 0))
   order by r.submitted_at desc, r.id desc
   limit greatest(1, least(coalesce(p_limit, 51), 101));
$$;
revoke all on function public.list_quote_requests(text, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_quote_requests(text, text, timestamptz, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Weekly count (FR-13): Monday 00:00:00 to the next Monday 00:00:00 America/Toronto, which stays
-- correct across daylight saving changes (AC-008.6). Won and Lost count requests whose current
-- status is Won (Lost) and whose last status change, the change to that status, is in the week.
-- Security invoker: RLS decides what the caller can count.
create or replace function app_private.weekly_counts_at(p_now timestamptz)
returns table (week_start timestamptz, week_end timestamptz, requests bigint, won bigint, lost bigint)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('week', p_now at time zone 'America/Toronto') at time zone 'America/Toronto') as ws,
           ((date_trunc('week', p_now at time zone 'America/Toronto') + interval '7 days')
              at time zone 'America/Toronto') as we
  )
  select b.ws,
         b.we,
         (select count(*) from public.quote_requests q
           where q.state = 'submitted' and q.submitted_at >= b.ws and q.submitted_at < b.we),
         (select count(*) from public.quote_requests q
           where q.state = 'submitted' and q.status = 'won'
             and q.status_changed_at >= b.ws and q.status_changed_at < b.we),
         (select count(*) from public.quote_requests q
           where q.state = 'submitted' and q.status = 'lost'
             and q.status_changed_at >= b.ws and q.status_changed_at < b.we)
  from bounds b;
$$;
revoke all on function app_private.weekly_counts_at(timestamptz) from public;
grant execute on function app_private.weekly_counts_at(timestamptz) to authenticated, service_role;

-- GET /api/weekly-counts/current. Only the current week is offered (NG-10).
create or replace function public.weekly_counts()
returns table (week_start timestamptz, week_end timestamptz, requests bigint, won bigint, lost bigint)
language sql
stable
set search_path = ''
as $$
  select * from app_private.weekly_counts_at(now());
$$;
revoke all on function public.weekly_counts() from public, anon;
grant execute on function public.weekly_counts() to authenticated, service_role;

commit;

-- rollback
-- begin;
-- drop function if exists public.weekly_counts();
-- drop function if exists app_private.weekly_counts_at(timestamptz);
-- drop function if exists public.list_quote_requests(text, text, timestamptz, uuid, integer);
-- drop function if exists public.ghl_stage_for_request(uuid);
-- drop function if exists public.find_ghl_contact_match(uuid);
-- drop function if exists public.finish_ghl_job(uuid, uuid, text, text, text);
-- drop function if exists public.claim_ghl_job(uuid, uuid, integer);
-- drop function if exists public.request_ghl_copy_retry(uuid);
-- drop function if exists public.change_quote_request_status(uuid, text, integer);
-- drop function if exists public.save_quote_request_quote(uuid, bigint, text, integer);
-- drop function if exists public.complete_quote_request(uuid, jsonb);
-- drop function if exists public.mark_sign_in_succeeded(uuid);
-- drop function if exists public.take_sign_in_attempt(text, text);
-- drop function if exists app_private.sign_in_pause_until(text, text, integer, interval, interval);
-- drop function if exists public.record_spam_refusal(text, text);
-- drop function if exists public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean);
-- drop function if exists public.take_submission_slot(text, integer, interval);
-- revoke execute on function app_private.new_reference() from service_role;
-- commit;
