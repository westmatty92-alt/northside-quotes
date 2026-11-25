-- Behaviour: REV-2. A same-token resend compares the photo plan, not just the photo count
-- (20261125000900_photo_plan_replay.sql, with the no-plan rule of 20261125001000_photo_plan_replay_fallback.sql).
-- One request per token, never a merge (S0 SEC-2);
-- AC-001.6 (double tap = one request), AC-002.1 and AC-002.6 (a resend stores the photos she attached).
-- Run as the server (service_role), like the route. Uploads go through storage.objects RLS as anon,
-- exactly like the Storage API with the public key.
-- now() is fixed inside one transaction, so "the plan changed after this upload" is simulated by moving
-- the request's photos_planned_at forward as the table owner.
-- Real data on staging: every assertion is scoped to this file's own form tokens.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

-- ---- the function itself ---------------------------------------------------------------------
select ok(to_regprocedure('public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean)') is null,
  'the old 10-argument start_quote_request is gone, so PostgREST never sees two overloads');
select ok(has_function_privilege('service_role',
            'public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb)', 'execute'),
  'the server may call start_quote_request');
select ok(not has_function_privilege('anon',
            'public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb)', 'execute'),
  'anon may not call start_quote_request');
select ok(not has_function_privilege('authenticated',
            'public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb)', 'execute'),
  'authenticated may not call start_quote_request');
select is((select prosecdef from pg_proc where oid = to_regprocedure(
            'public.start_quote_request(uuid, text, text, text, text, text, text, integer, text, boolean, jsonb)')), false,
  'start_quote_request stays security invoker');

set local role service_role;

-- ---- pending: the same set is a replay -------------------------------------------------------
-- Plan P: photo 1 JPEG 2,097,152 bytes, photo 2 PNG 1,048,576 bytes.
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":2097152},{"position":2,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'created', 'a new token with a photo plan creates one pending request');
select is((select photo_plan from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'),
  '[{"position":1,"content_type":"image/jpeg","size_bytes":2097152},{"position":2,"content_type":"image/png","size_bytes":1048576}]'::jsonb,
  'the plan is stored with the pending request');
select is((select photos_planned_at from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'), now(),
  'the plan time is the time the request was started');

select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":2097152},{"position":2,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'replayed', 'AC-001.6: the same token, answers and photo set before any upload is a replay (double tap)');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"size_bytes":2097152,"content_type":"image/jpeg","position":1},{"position":2,"size_bytes":1048576.0,"content_type":"image/png"}]')
           ->> 'outcome'),
  'replayed', 'the same set written with other key order or number spelling is the same set');

-- photo 1 uploads on the first try (it is newer than the plan); photo 2 fails on a dropped connection
reset role;
select set_config('nq_test.photo_1', (select id::text || '/photo-1' from public.quote_requests
                                       where submission_key = 'f1000000-0000-4000-8000-000000000001'), true);
set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('quote-photos', %L) $$,
                       current_setting('nq_test.photo_1')),
  'photo 1 of the first try is uploaded');
reset role;
set local role service_role;

select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":2097152},{"position":2,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'replayed', 'AC-002.6: Send again with the same photos after a failed upload is a replay that keeps photo 1');

-- ---- pending: a swapped photo with the same count is NOT a replay ------------------------------
-- She swaps photo 1 (2,097,152 bytes) for another JPEG of 2,101,234 bytes. Same count, same types.
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":2101234},{"position":2,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'updated', 'REV-2: a swapped photo with the same count is updated (the route clears the uploads), not replayed');
select is((select photo_plan -> 0 ->> 'size_bytes' from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'),
  '2101234', 'the pending request holds the new plan');
select is((select count(*) from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'), 1::bigint,
  'SEC-2: still one request for the token');

select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/webp","size_bytes":2101234},{"position":2,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'updated', 'a photo of another type with the same size and count is updated, not replayed');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/png","size_bytes":1048576},{"position":2,"content_type":"image/webp","size_bytes":2101234}]')
           ->> 'outcome'),
  'updated', 'the same two photos in the other order are a changed set (positions are paths), not a replay');

-- ---- pending: a cleanup that did not run is run again ----------------------------------------
-- The route's cleanup after that update failed (503), so photo 1 of the first try is still in the
-- folder, older than the current plan. Simulate "the plan was set after that upload".
reset role;
update public.quote_requests set photos_planned_at = photos_planned_at + interval '1 second'
 where submission_key = 'f1000000-0000-4000-8000-000000000001';
set local role service_role;
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/png","size_bytes":1048576},{"position":2,"content_type":"image/webp","size_bytes":2101234}]')
           ->> 'outcome'),
  'updated', 'REV-2: an unchanged resend while an upload from an earlier try is left over is updated again, so the cleanup repeats');
select is((select photos_planned_at from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'), now(),
  'the repeated update restarts the plan time');

-- ---- pending: a different count, and changed answers, are updated as before ---------------------
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 1, null, false,
            '[{"position":1,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'updated', 'a different photo count on a pending request is updated, as before');
select is((select photo_count::integer || ':' || jsonb_array_length(photo_plan)
             from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'),
  '1:1', 'the count and the plan move together');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, null, false,
            '[{"position":1,"content_type":"image/png","size_bytes":1048576}]')
           ->> 'outcome'),
  'updated', 'changed answers with the same photo set are updated, as before');
select is((select count(*) from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000001'), 1::bigint,
  'SEC-2: one request for the token after every resend');

-- ---- submitted: same set replays, a changed set is refused --------------------------------------
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":1000}]')
           ->> 'outcome'),
  'created', 'a second token creates its own pending request');
select ok((public.complete_quote_request(q.id, jsonb_build_array(jsonb_build_object(
             'position', 1, 'storage_path', q.id::text || '/photo-1', 'content_type', 'image/jpeg', 'size_bytes', 1000)))
           ->> 'reference') is not null, 'that request is completed')
  from public.quote_requests q where q.submission_key = 'f1000000-0000-4000-8000-000000000002';

select is((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":1000}]')
           ->> 'outcome'),
  'replayed', 'the same set after submitting is a replay');
select ok((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":1000}]')
           ->> 'reference') is not null, 'and returns the reference');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":1001}]')
           ->> 'outcome'),
  'token_used', 'REV-2: a swapped photo with the same count after submitting is refused (409 form_already_used), not replayed');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 2, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":1000},{"position":2,"content_type":"image/png","size_bytes":5000}]')
           ->> 'outcome'),
  'token_used', 'a different count after submitting is refused, as before');
select is((select photo_plan from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000002'),
  '[{"position":1,"content_type":"image/jpeg","size_bytes":1000}]'::jsonb,
  'SEC-2: the submitted request and its plan are unchanged, never merged');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000002', 'Sam Submitted', '9055550147', 'sam@example.com',
            '20 Barton St W, Hamilton ON', 'Basement floor drain backs up', 'soon', 1, null, false) ->> 'outcome'),
  'replayed', 'a caller that sends no plan still gets the submitted request when the answers and count match');

-- ---- no plan sent (the route as built at 4b20835), 20261125001000 ------------------------------
-- The form skips photos it already uploaded when its body is unchanged, so without a plan the photo
-- count must decide exactly as before 0900, or the server would clear a photo the form will not re-send.
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000003', 'Noel Noplan', '9055550148', 'noel@example.com',
            '21 Barton St W, Hamilton ON', 'Laundry sink drains very slowly', 'flexible', 1, null) ->> 'outcome'),
  'created', 'a create without a plan still works');
select ok((select photo_plan is null from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000003'),
  'and stores no plan');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000003', 'Noel Noplan', '9055550148', 'noel@example.com',
            '21 Barton St W, Hamilton ON', 'Laundry sink drains very slowly', 'flexible', 1, null) ->> 'outcome'),
  'replayed', 'without a plan the photo count decides, as before (the form keeps the photos it already uploaded)');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000003', 'Noel Noplan', '9055550148', 'noel@example.com',
            '21 Barton St W, Hamilton ON', 'Laundry sink drains very slowly', 'flexible', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":3000}]') ->> 'outcome'),
  'replayed', 'a plan sent for a request stored without one: the count decides, so it replays');
select is((select photo_plan from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000003'),
  '[{"position":1,"content_type":"image/jpeg","size_bytes":3000}]'::jsonb,
  'and that plan is kept for the next comparison');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000003', 'Noel Noplan', '9055550148', 'noel@example.com',
            '21 Barton St W, Hamilton ON', 'Laundry sink drains very slowly', 'flexible', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":3000}]') ->> 'outcome'),
  'replayed', 'after that the same set replays');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000003', 'Noel Noplan', '9055550148', 'noel@example.com',
            '21 Barton St W, Hamilton ON', 'Laundry sink drains very slowly', 'flexible', 1, null, false,
            '[{"position":1,"content_type":"image/jpeg","size_bytes":3001}]') ->> 'outcome'),
  'updated', 'and a swapped photo is updated');

-- a left-over upload forces an update even when no plan is sent, so the current route's cleanup repeats too
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000006', 'Lou Leftover', '9055550151', 'lou@example.com',
            '24 Barton St W, Hamilton ON', 'Kitchen drain gurgles and backs up', 'soon', 1, null) ->> 'outcome'),
  'created', 'a request without a plan, one photo planned');
reset role;
select set_config('nq_test.photo_6', (select id::text || '/photo-1' from public.quote_requests
                                       where submission_key = 'f1000000-0000-4000-8000-000000000006'), true);
set local role anon;
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('quote-photos', %L) $$,
                       current_setting('nq_test.photo_6')),
  'its photo is uploaded');
reset role;
set local role service_role;
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000006', 'Lou Leftover', '9055550151', 'lou@example.com',
            '24 Barton St W, Hamilton ON', 'Kitchen drain gurgles and backs up', 'soon', 1, null) ->> 'outcome'),
  'replayed', 'an upload newer than the plan is kept on an unchanged resend');
reset role;
update public.quote_requests set photos_planned_at = photos_planned_at + interval '1 second'
 where submission_key = 'f1000000-0000-4000-8000-000000000006';
set local role service_role;
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000006', 'Lou Leftover', '9055550151', 'lou@example.com',
            '24 Barton St W, Hamilton ON', 'Kitchen drain gurgles and backs up', 'soon', 1, null) ->> 'outcome'),
  'updated', 'an upload older than the plan (a cleanup that failed) is updated again without a plan too');

select is((public.start_quote_request('f1000000-0000-4000-8000-000000000004', 'Zoe Zero', '9055550149', 'zoe@example.com',
            '22 Barton St W, Hamilton ON', 'Dripping shower head all day', 'flexible', 0, null) ->> 'outcome'),
  'created', 'a request without photos');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000004', 'Zoe Zero', '9055550149', 'zoe@example.com',
            '22 Barton St W, Hamilton ON', 'Dripping shower head all day', 'flexible', 0, null) ->> 'outcome'),
  'replayed', 'without photos there is nothing to tell apart: a resend without a plan replays');
select is((public.start_quote_request('f1000000-0000-4000-8000-000000000004', 'Zoe Zero', '9055550149', 'zoe@example.com',
            '22 Barton St W, Hamilton ON', 'Dripping shower head all day', 'flexible', 0, null, false, '[]') ->> 'outcome'),
  'replayed', 'and so does one with an empty plan');

-- ---- a malformed plan is refused before anything is stored --------------------------------------
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Plan does not match the count', 'soon', 2, null, false,
                     '[{"position":1,"content_type":"image/jpeg","size_bytes":1000}]') $$,
  'PT422', null, 'a plan whose length is not the photo count is refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Plan is not an array', 'soon', 1, null, false,
                     '{"position":1,"content_type":"image/jpeg","size_bytes":1000}') $$,
  'PT422', null, 'a plan that is not an array is refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Positions out of order', 'soon', 2, null, false,
                     '[{"position":2,"content_type":"image/jpeg","size_bytes":1000},{"position":1,"content_type":"image/jpeg","size_bytes":1000}]') $$,
  'PT422', null, 'positions out of order are refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Unknown photo type here', 'soon', 1, null, false,
                     '[{"position":1,"content_type":"image/gif","size_bytes":1000}]') $$,
  'PT422', null, 'a type other than JPEG, PNG or WebP is refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Photo is far too large', 'soon', 1, null, false,
                     '[{"position":1,"content_type":"image/jpeg","size_bytes":5242881}]') $$,
  'PT422', null, 'a size over 5,242,880 bytes is refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Size written as text', 'soon', 1, null, false,
                     '[{"position":1,"content_type":"image/jpeg","size_bytes":"1000"}]') $$,
  'PT422', null, 'a size that is not a number is refused');
select throws_ok($$ select public.start_quote_request('f1000000-0000-4000-8000-000000000005', 'Bad Plan', '9055550150', 'bad@example.com',
                     '23 Barton St W, Hamilton ON', 'Size with a fraction', 'soon', 1, null, false,
                     '[{"position":1,"content_type":"image/jpeg","size_bytes":10.5}]') $$,
  'PT422', null, 'a size that is not a whole number is refused');
select is((select count(*) from public.quote_requests where submission_key = 'f1000000-0000-4000-8000-000000000005'), 0::bigint,
  'no refused plan stored anything');

reset role;

-- ---- the column rule ---------------------------------------------------------------------------
select throws_ok($$ update public.quote_requests set photo_plan = '[]'::jsonb
                     where submission_key = 'f1000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'a stored plan always lists exactly photo_count photos');

select * from finish();
rollback;
