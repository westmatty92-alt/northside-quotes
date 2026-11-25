-- 20261125001000_photo_plan_replay_fallback.sql
-- Purpose: correct rule 3 of 20261125000900_photo_plan_replay.sql (REV-2) before the route sends plans.
--          FR-3, FR-6 · US-002 · AC-002.6 · S0 SEC-2.
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md (unchanged).
--
-- What was wrong with 0900 rule 3 ("no plan sent and photos planned -> always updated"): the form
-- (src/components/request/request-form.tsx) skips the photos it already uploaded when its own body
-- signature is unchanged since the last successful create. The route as built sends no plan, so 0900
-- answered that resend `updated`, the route removed every upload, and the form re-sent only the photos
-- it had not uploaded yet. Submit then refused the skipped photo as missing (422), the next Send cleared
-- the other one, and the AC-002.6 flow ("Send again completes the request") could loop. Found by reading
-- the form after 0900 reached staging; 0900 is applied, so this is a new migration.
--
-- Rules now (outcomes, response codes and the contract are unchanged):
--   * No plan sent (p_photos null): the photo count decides, exactly as before 0900. The form and the
--     server agree again on what a replay is. REV-2's swapped photo is only detected once the route
--     sends p_photos (contract question in .baseleap/reports/A2.md, Attempt 3: REV-2).
--   * Plan sent, none stored (a request started before the route sent plans): the count decides, and
--     on a replay the sent plan is stored so the next resend is compared in full.
--   * Plan sent and stored: compared in full (0900 rule 1, unchanged).
--   * Pending request with an upload older than photos_planned_at: `updated` whatever was sent (0900
--     rule 2, unchanged). That state only follows an `updated` whose cleanup failed; the route then
--     answered 503, the form kept its previous signature, and re-uploads everything, so they agree.
--   * Submitted request: unchanged from 0900.
-- Same signature and defaults as 0900, so create or replace keeps one function (no PostgREST overload).

begin;

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
  v_plan_ok boolean;   -- the plans match, or one side is unknown and the count decides
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
    -- Unknown on either side: the photo count, already in v_same, decides (as before 0900).
    v_plan_ok := v_plan is null or v_stored is null or v_plan = v_stored;

    if v_req.state = 'submitted' then
      -- A submitted request never changes. A different plan is a changed answer (409).
      if v_same and v_plan_ok then
        return jsonb_build_object('outcome', 'replayed', 'request_id', v_req.id, 'state', v_req.state,
                                  'reference', v_req.reference, 'photo_count', v_req.photo_count,
                                  'created_at', v_req.created_at);
      end if;
      return jsonb_build_object('outcome', 'token_used');
    end if;

    -- Pending. Served by the unique (bucket_id, name) index of storage.objects: three exact names.
    -- An object with no created_at counts as left over, and so does an unreadable folder: both fail
    -- towards a re-upload, never towards a wrong photo. (service_role reads storage.objects: the
    -- Storage API runs service-key requests as that role; proven on staging by
    -- supabase/tests/functions/photo_plan_replay.sql.)
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

    if v_same and v_plan_ok and not v_stale then
      if v_stored is null and v_plan is not null then
        -- started before the route sent plans: keep this plan so the next resend is compared in full
        update public.quote_requests set photo_plan = v_plan where id = v_req.id;
      end if;
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
-- Not destructive. Restores 0900's version (rule 3: no plan sent and photos planned -> always updated),
-- which loops the form's resend-after-failed-upload flow while the route sends no plan; prefer rolling
-- back 0900 too (its rollback block) if this one is rolled back.
-- begin;
-- -- re-run the "create function public.start_quote_request(...)" body and its revoke/grant lines from
-- -- 20261125000900_photo_plan_replay.sql as "create or replace function", unchanged.
-- commit;
