-- 20261125000900_photo_plan_replay.sql
-- Purpose: REV-2 (.baseleap/reviews/REV1.md, Important). A resend with the same form token must not
--          keep photos from an earlier try when the homeowner changed a photo.
--          FR-3, FR-6 · US-001, US-002 · AC-001.6, AC-002.1, AC-002.6 · S0 SEC-2.
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md (unchanged: same outcomes, same contract).
--
-- Root cause. start_quote_request() (20261120000600_functions.sql:113-120) compared the answers and the
-- photo COUNT only. A resend with the same token, the same answers and the same count was `replayed`,
-- so the route kept the uploads of the first try. The form uploads every photo again, Storage refuses
-- to overwrite (409, no update policy), the upload helper counts that 409 as "already uploaded", and
-- submitQuoteRequest stored the photo from the first try. A second path led to the same end: when the
-- route's cleanup after an `updated` outcome failed (503), the next resend was `replayed` and the
-- cleanup never ran again.
--
-- Design (no new outcome, no new response code, no contract change):
--   1. The photo plan the create body already carries (QuoteRequestCreate.photos: position,
--      content_type, size_bytes per photo; docs/openapi.yaml PhotoPlan) is stored with the pending
--      request in canonical form (quote_requests.photo_plan) and compared on the same-token path like
--      every other answer. A changed photo of a different type or byte size is a changed answer:
--      pending -> `updated` (the route clears the uploads, they are uploaded again); submitted ->
--      `token_used` (409 form_already_used). One request per token, never a merge (SEC-2 holds).
--   2. quote_requests.photos_planned_at is the time the current plan and answers were set. On the
--      same-token path of a PENDING request, any object in its folder that is older than that time
--      is left over from an earlier try whose cleanup did not run: the outcome is `updated` again, so
--      the route's cleanup is repeatable without any new state for the route to manage.
--   3. A caller that sends no plan (p_photos null: the route as built today) is never replayed onto a
--      pending request that plans photos: it is `updated`, so the uploads are always cleared and
--      re-uploaded. That costs a re-upload, never a wrong photo. Once the route passes p_photos, an
--      unchanged resend is a true replay again and keeps its uploads.
--   Residual (not detectable from the contract's fields): a swap for a different file with the SAME
--   type and the SAME byte size. Closed on the client (count a 409 as uploaded only for an unchanged
--   file, otherwise send again with a fresh token) and the server (refuse a stored object whose size
--   differs from the plan); both are contract questions in .baseleap/reports/A2.md, Attempt 3: REV-2.
--
-- The function gains a trailing parameter, so the old 10-argument version is dropped first: two
-- overloads with the same named arguments would make PostgREST's rpc call ambiguous (PGRST203).
-- Positional and named calls with 9 or 10 arguments keep working through the defaults.

begin;

alter table public.quote_requests
  add column if not exists photo_plan jsonb,                                  -- [{position, content_type, size_bytes}] in position order; null for rows from before this migration or a caller that sent no plan
  add column if not exists photos_planned_at timestamptz not null default now();  -- when the current answers and photo plan were set; uploads older than this belong to an earlier try

alter table public.quote_requests drop constraint if exists quote_requests_photo_plan_shape;
alter table public.quote_requests add constraint quote_requests_photo_plan_shape
  check (photo_plan is null
         or (jsonb_typeof(photo_plan) = 'array' and jsonb_array_length(photo_plan) = photo_count));

comment on column public.quote_requests.photo_plan is
  'Photo plan of the create body (position, content_type, size_bytes), canonical form; compared on a same-token resend (REV-2).';
comment on column public.quote_requests.photos_planned_at is
  'When the answers and photo plan were last set; on a same-token resend of a pending request, an upload older than this is left over and forces updated (REV-2).';

drop function if exists public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean);

-- start_quote_request: POST /api/quote-requests after the token, honeypot and zod checks.
-- One call per create; every call for one form token is serialised by an advisory lock, so two
-- concurrent creates with the same token resolve to ONE request (S0 SEC-2). The offers choice
-- (FR-25) and the photo plan are compared like every other field.
-- p_photos: the create body's photos array as validated by the route ([{position, content_type,
-- size_bytes}], positions 1..n in order, n = p_photo_count). Null = no plan sent (see design 3).
-- Outcomes:
--   created       new pending request (201); took a rate-limit slot
--   replayed      same token, same answers, same photo plan: the existing request (200). For a pending
--                 request also: the plan was sent and no upload in its folder predates the plan.
--   updated       same token, request still pending, and anything else: changed answers, a changed
--                 photo plan, no plan sent while photos are planned, or a left-over upload. The row is
--                 updated (one request, never a second); the route clears the uploaded photos so they
--                 are uploaded again (200)
--   token_used    same token, changed answers or a changed photo plan, already submitted: nothing
--                 changes (409 form_already_used; the page gets a fresh token and keeps what was typed)
--   rate_limited  a new request from an address with 5 accepted in 10 minutes (429)
-- p_ip_hash null (no address) or a failing counter accepts the request (AC-003.5).
-- A malformed p_photos is PT422 (the route has already validated it, so this is a backstop).
create function public.start_quote_request(
  p_submission_key uuid,
  p_name           text,
  p_phone          text,
  p_email          text,
  p_address        text,
  p_problem        text,
  p_urgency        text,
  p_photo_count    integer,
  p_ip_hash        text,
  p_marketing_consent boolean default false,
  p_photos         jsonb default null)
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
  v_plan    jsonb;     -- the sent plan in canonical form; null when none was sent and photos are planned
  v_stored  jsonb;     -- the stored plan; null when unknown
  v_same    boolean;   -- answers and photo count unchanged
  v_stale   boolean;   -- an upload in the folder predates the current plan
begin
  if p_submission_key is null then
    raise exception 'form token nonce required' using errcode = 'PT422';
  end if;

  -- The photo plan, checked and put in canonical form before anything is read or written.
  if p_photos is not null then
    if jsonb_typeof(p_photos) is distinct from 'array' then
      raise exception 'photo plan must be an array' using errcode = 'PT422';
    end if;
    if jsonb_array_length(p_photos) is distinct from p_photo_count then
      raise exception 'photo plan must list exactly the planned photos' using errcode = 'PT422';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_photos) with ordinality as e(photo, n)
       where case
               when jsonb_typeof(photo) is distinct from 'object' then true
               when jsonb_typeof(photo -> 'position') is distinct from 'number' then true
               when (photo ->> 'position') is distinct from n::text then true          -- positions 1..n, in order
               when coalesce(photo ->> 'content_type', '') not in ('image/jpeg', 'image/png', 'image/webp') then true
               when jsonb_typeof(photo -> 'size_bytes') is distinct from 'number' then true
               when (photo ->> 'size_bytes')::numeric <> trunc((photo ->> 'size_bytes')::numeric) then true
               when (photo ->> 'size_bytes')::numeric not between 1 and 5242880 then true  -- FR-6, the bucket limit
               else false
             end)
    then
      raise exception 'photo plan entries need position, type and size' using errcode = 'PT422';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('position', n::integer,
                                                 'content_type', photo ->> 'content_type',
                                                 'size_bytes', (photo ->> 'size_bytes')::numeric::integer)
                              order by n), '[]'::jsonb)
      into v_plan
      from jsonb_array_elements(p_photos) with ordinality as e(photo, n);
  elsif p_photo_count = 0 then
    v_plan := '[]'::jsonb;  -- no photos: there is nothing to tell apart
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quote_submission:' || p_submission_key::text, 0));

  select * into v_req from public.quote_requests where submission_key = p_submission_key for update;

  if found then
    v_stored := coalesce(v_req.photo_plan, case when v_req.photo_count = 0 then '[]'::jsonb end);
    v_same := (v_req.name, v_req.phone, v_req.email, v_req.address, v_req.problem, v_req.urgency,
               v_req.photo_count::integer, v_req.marketing_consent)
              is not distinct from (p_name, p_phone, p_email, p_address, p_problem, p_urgency, p_photo_count,
                                    v_consent);

    if v_req.state = 'submitted' then
      -- A submitted request never changes. A different plan is a changed answer (409). When either
      -- plan is unknown (no plan sent, or a row from before this migration) the photo count, already
      -- in v_same, decides, so a double tap after submitting still gets its reference.
      if v_same and (v_plan is null or v_stored is null or v_plan = v_stored) then
        return jsonb_build_object('outcome', 'replayed', 'request_id', v_req.id, 'state', v_req.state,
                                  'reference', v_req.reference, 'photo_count', v_req.photo_count,
                                  'created_at', v_req.created_at);
      end if;
      return jsonb_build_object('outcome', 'token_used');
    end if;

    -- Pending. Served by the unique (bucket_id, name) index of storage.objects: three exact names.
    -- An object with no created_at counts as left over, and so does an unreadable folder: both fail
    -- towards a re-upload, never towards a wrong photo. (service_role reads storage.objects: the
    -- Storage API runs service-key requests as that role. The replay test in
    -- supabase/tests/functions/photo_plan_replay.sql fails if it ever cannot.)
    begin
      v_stale := exists (
        select 1
          from storage.objects o
         where o.bucket_id = 'quote-photos'
           and o.name in (v_req.id::text || '/photo-1', v_req.id::text || '/photo-2', v_req.id::text || '/photo-3')
           and coalesce(o.created_at, '-infinity'::timestamptz) < v_req.photos_planned_at);
    exception when insufficient_privilege or undefined_table then
      v_stale := true;
    end;

    if v_same and v_plan is not null and v_stored is not null and v_plan = v_stored and not v_stale then
      return jsonb_build_object('outcome', 'replayed', 'request_id', v_req.id, 'state', v_req.state,
                                'reference', v_req.reference, 'photo_count', v_req.photo_count,
                                'created_at', v_req.created_at);
    end if;

    update public.quote_requests
       set name = p_name, phone = p_phone, email = p_email, address = p_address,
           problem = p_problem, urgency = p_urgency, photo_count = p_photo_count,
           marketing_consent = v_consent, photo_plan = v_plan, photos_planned_at = now()
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
                                     marketing_consent, photo_plan, photos_planned_at)
  values (p_submission_key, p_name, p_phone, p_email, p_address, p_problem, p_urgency, p_photo_count,
          v_consent, v_plan, now())
  returning * into v_req;

  return jsonb_build_object('outcome', 'created', 'request_id', v_req.id, 'state', v_req.state,
                            'reference', null, 'photo_count', v_req.photo_count,
                            'created_at', v_req.created_at);
end
$$;
revoke all on function public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb) to service_role;

commit;

-- rollback
-- Not destructive for requests or photos; drops only the stored photo plans and plan times.
-- begin;
-- drop function if exists public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb);
-- -- then re-create the previous version: run the "create or replace function public.start_quote_request(...)"
-- -- statement and its revoke/grant lines from 20261120000600_functions.sql (lines 81-167) unchanged.
-- alter table public.quote_requests drop constraint if exists quote_requests_photo_plan_shape;
-- alter table public.quote_requests drop column if exists photos_planned_at;
-- alter table public.quote_requests drop column if exists photo_plan;
-- commit;
