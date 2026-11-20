-- Behaviour: start_quote_request (one request per form token, S0 SEC-2), take_submission_slot
-- (FR-8, S0 SEC-3) and the sign-in pause functions (FR-9, S0 SEC-3), run as the server.
-- Real parallelism needs several connections, which pgTAP does not have: the advisory locks make
-- concurrent calls run one after another, so N calls in one transaction show the same counts.
-- QA's parallel HTTP probes (docs/architecture.md, S0 checks) prove it end to end.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

set local role service_role;

-- ---- one form token, one request -----------------------------------------------------------
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 1, repeat('a1', 32)) ->> 'outcome'),
  'created', 'a new form token creates one pending request');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 1, repeat('a1', 32)) ->> 'outcome'),
  'replayed', 'the same token with the same fields is a replay (double tap, or the loser of two concurrent creates)');
select is((select count(*) from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'), 1::bigint,
  'still one request for the token');
select is((select count(*) from public.rate_limit_hits where ip_hash = repeat('a1', 32)), 1::bigint,
  'a replay takes no rate-limit slot');
select throws_ok($$ insert into public.quote_requests (submission_key, name, phone, email, address, problem, urgency)
                    values ('e0000000-0000-4000-8000-000000000001', 'Other Person', '9055550143', 'o@example.com',
                            '15 Barton St W, Hamilton ON', 'A different problem text', 'soon') $$,
  '23505', null, 'a second row for one form token is impossible (unique submission_key backstop)');

select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32)) ->> 'outcome'),
  'updated', 'changed fields on a pending request update it (the route then clears its uploaded photos)');
select is((select urgency from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'), 'emergency',
  'the pending request holds the new answer');

select ok((public.complete_quote_request(q.id, jsonb_build_array(jsonb_build_object(
             'position', 1, 'storage_path', q.id::text || '/photo-1', 'content_type', 'image/jpeg', 'size_bytes', 1000)))
           ->> 'reference') is not null, 'the request is completed')
  from public.quote_requests q where q.submission_key = 'e0000000-0000-4000-8000-000000000001';

select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32)) ->> 'state'),
  'submitted', 'a retry with the same fields after submitting returns the submitted request (and its reference)');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Chris Back', '9055550144', 'chris@example.com',
            '16 Barton St W, Hamilton ON', 'Different details after pressing Back', 'soon', 0, repeat('a1', 32)) ->> 'outcome'),
  'token_used', 'different details with a used token are refused (409 form_already_used), never merged (S0 SEC-2)');
select is((select name from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'), 'Dana Whitfield',
  'the submitted request is unchanged');

select is((public.start_quote_request('e0000000-0000-4000-8000-000000000002', 'No Address', '9055550145', 'n@example.com',
            '17 Barton St W, Hamilton ON', 'Request without a known address', 'soon', 0, null) ->> 'outcome'),
  'created', 'no network address: accepted (AC-003.5)');

-- ---- rate limit: 5 accepted per address per 10 minutes, atomic ------------------------------
select is((select count(*) filter (where public.take_submission_slot(repeat('b2', 32))) from generate_series(1, 20)), 5::bigint,
  '20 calls from one address accept exactly 5');
select is((select count(*) from public.rate_limit_hits where ip_hash = repeat('b2', 32)), 5::bigint,
  'only accepted submissions are recorded');
select ok(public.take_submission_slot(repeat('b3', 32)), 'another address still has its own 5');

select is((select count(*) filter (where public.start_quote_request(gen_random_uuid(), 'Bot Person', '9055550100', 'bot@example.com',
             '1 Main St W, Hamilton', 'Repeated request text here', 'soon', 0, repeat('c3', 32)) ->> 'outcome' = 'rate_limited')
             from generate_series(1, 6)), 1::bigint,
  'the 6th new request from one address within 10 minutes is refused (AC-003.4)');
select is((select count(*) from public.quote_requests where email = 'bot@example.com'), 5::bigint,
  'and is not stored');
select ok((public.start_quote_request(gen_random_uuid(), 'Bot Person', '9055550100', 'bot@example.com',
             '1 Main St W, Hamilton', 'Repeated request text here', 'soon', 0, repeat('c3', 32)) ->> 'retry_after_seconds')::integer between 1 and 600,
  'a refusal says how long to wait (Retry-After)');

insert into public.rate_limit_hits (ip_hash, created_at)
select repeat('d4', 32), now() - interval '11 minutes' from generate_series(1, 5);
select ok(public.take_submission_slot(repeat('d4', 32)), 'submissions older than 10 minutes no longer count');

-- ---- sign-in pause: 5 failures per email per 15 minutes, atomic ------------------------------
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('e5', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 20)), 5::bigint,
  '20 parallel guesses for one email reach Supabase Auth only 5 times');
select is((select count(*) from public.sign_in_attempts where email_hash = repeat('e5', 32)), 5::bigint,
  'refused attempts during the pause are not counted');
select ok((public.take_sign_in_attempt(repeat('e5', 32)) ->> 'retry_after_seconds')::integer between 1 and 900,
  'the pause says how long to wait (Retry-After)');

select ok(public.mark_sign_in_succeeded((public.take_sign_in_attempt(repeat('f6', 32)) ->> 'attempt_id')::uuid),
  'a staff sign-in marks its attempt as succeeded');
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('f6', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 5)), 5::bigint,
  'a successful attempt is not a failure: 5 more attempts are still allowed');
select is((public.take_sign_in_attempt(repeat('f6', 32)) ->> 'allowed')::boolean, false,
  'the 6th attempt after 5 failures is paused');

insert into public.sign_in_attempts (email_hash, succeeded, created_at)
select repeat('a8', 32), false, now() - interval '16 minutes' from generate_series(1, 5);
select is((public.take_sign_in_attempt(repeat('a8', 32)) ->> 'allowed')::boolean, true,
  'failures older than 15 minutes no longer pause');

reset role;

select * from finish();
rollback;
