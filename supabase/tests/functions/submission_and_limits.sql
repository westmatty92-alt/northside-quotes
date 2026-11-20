-- Behaviour: start_quote_request (one request per form token, S0 SEC-2; the offers choice,
-- FR-25), take_submission_slot (FR-8, S0 SEC-3), record_spam_refusal (FR-8 event cap, S0 SEC-14,
-- AC-003.7, AC-003.8) and the sign-in limits (FR-9 as changed by ruling 4A, AC-004.5, AC-004.11,
-- AC-004.12, AC-004.13, S0 SEC-3), run as the server.
-- Real parallelism needs several connections, which pgTAP does not have: the advisory locks make
-- concurrent calls run one after another, so N calls in one transaction show the same counts.
-- now() is fixed inside one transaction, so the passing of time is simulated by moving stored
-- times back. QA's parallel HTTP probes (docs/architecture.md, S0 checks) prove it end to end.
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

-- the offers choice is compared like every other field (FR-25)
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32), true) ->> 'outcome'),
  'updated', 'ticking the offers box after a first try is a change, not a replay');
select is((select marketing_consent from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'), true,
  'the pending request now holds consent yes');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32), true) ->> 'outcome'),
  'replayed', 'the same fields with the same offers choice are a replay');
select ok((select marketing_consent_at is null from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'),
  'no consent time while pending: it is the time the request is stored');

select ok((public.complete_quote_request(q.id, jsonb_build_array(jsonb_build_object(
             'position', 1, 'storage_path', q.id::text || '/photo-1', 'content_type', 'image/jpeg', 'size_bytes', 1000)))
           ->> 'reference') is not null, 'the request is completed')
  from public.quote_requests q where q.submission_key = 'e0000000-0000-4000-8000-000000000001';
select ok((select marketing_consent and marketing_consent_at = submitted_at
             from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'),
  'AC-001.14: a ticked request is stored with consent yes and a consent time equal to the time it was stored');

select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32), true) ->> 'state'),
  'submitted', 'a retry with the same fields after submitting returns the submitted request (and its reference)');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '9055550142', 'dana@example.com',
            '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'emergency', 1, repeat('a1', 32), false) ->> 'outcome'),
  'token_used', 'unticking the box with a used token is refused like any other change (409 form_already_used)');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000001', 'Chris Back', '9055550144', 'chris@example.com',
            '16 Barton St W, Hamilton ON', 'Different details after pressing Back', 'soon', 0, repeat('a1', 32)) ->> 'outcome'),
  'token_used', 'different details with a used token are refused (409 form_already_used), never merged (S0 SEC-2)');
select is((select name from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000001'), 'Dana Whitfield',
  'the submitted request is unchanged');
select throws_ok($$ update public.quote_requests set marketing_consent = false, marketing_consent_at = null
                     where submission_key = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'NG-16: a stored request''s offers choice cannot be changed, even by the server');

select is((public.start_quote_request('e0000000-0000-4000-8000-000000000002', 'No Address', '9055550145', 'n@example.com',
            '17 Barton St W, Hamilton ON', 'Request without a known address', 'soon', 0, null) ->> 'outcome'),
  'created', 'no network address: accepted (AC-003.5)');
select is((select marketing_consent from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000002'), false,
  'AC-001.15: no offers value given → consent no');
select is((public.start_quote_request('e0000000-0000-4000-8000-000000000003', 'Null Consent', '9055550146', 'nc@example.com',
            '18 Barton St W, Hamilton ON', 'Request with an unclear offers value', 'soon', 0, null, null) ->> 'outcome'),
  'created', 'an unclear offers value (the route passes null or false) is still accepted');
select is((select marketing_consent from public.quote_requests where submission_key = 'e0000000-0000-4000-8000-000000000003'), false,
  'AC-001.17: anything but a clear yes is stored as consent no');

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

-- ---- spam refusal events: one per address and reason per 10 minutes, 1,000 a day (SEC-14) ----
select is((select count(*) filter (where (public.record_spam_refusal(repeat('5a', 32), 'honeypot') ->> 'logged')::boolean)
             from generate_series(1, 30)), 30::bigint,
  '30 honeypot refusals from one address are all accounted for');
select is((select count(*) from public.events where name = 'spam_submission_blocked'), 1::bigint,
  'AC-003.7: exactly 1 spam_submission_blocked event for that address and reason in the window');
select is((select (properties ->> 'count')::integer from public.events where name = 'spam_submission_blocked'), 30,
  'AC-003.7: its count is 30');
select ok((select properties ?& array['reason', 'count'] and not (properties ? 'ip_hash')
             and properties ->> 'reason' = 'honeypot'
             from public.events where name = 'spam_submission_blocked'),
  'AC-003.7: the event holds the reason and count and no network address');
select is((public.record_spam_refusal(repeat('5a', 32), 'too_fast') ->> 'count')::integer, 1,
  'another reason from the same address opens its own window');
select is((public.record_spam_refusal(repeat('5b', 32), 'honeypot') ->> 'count')::integer, 1,
  'another address opens its own window');
select is((select count(*) from public.events where name = 'spam_submission_blocked'), 3::bigint, 'three events so far');

update public.spam_refusal_windows set window_start = window_start - interval '11 minutes' where ip_hash = repeat('5a', 32);
select is((public.record_spam_refusal(repeat('5a', 32), 'honeypot') ->> 'count')::integer, 1,
  'after 10 minutes the next refusal starts a new window with a new event');
select is((select count(*) from public.events where name = 'spam_submission_blocked'), 4::bigint, 'a fourth event');

insert into public.events (name, properties)
select 'spam_submission_blocked', '{"reason":"rate_limited","count":1}'::jsonb from generate_series(1, 996);
select is((select count(*) from public.events where name = 'spam_submission_blocked'
             and created_at >= date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto'), 1000::bigint,
  '1,000 spam events recorded for this Hamilton day');
select is((public.record_spam_refusal(repeat('5c', 32), 'honeypot') ->> 'logged')::boolean, false,
  'AC-003.8: a refusal from a new address past the daily cap is not logged');
select is((select count(*) from public.events where name = 'spam_submission_blocked'), 1000::bigint,
  'AC-003.8: the events table gains no new row');
select is((select count(*) from public.spam_refusal_windows where ip_hash = repeat('5c', 32)), 0::bigint,
  'and nothing at all is written for it, so a flood cannot grow the window table either');
select is((public.record_spam_refusal(repeat('5b', 32), 'honeypot') ->> 'count')::integer, 2,
  'an address whose window is already open keeps counting into its existing event');
select throws_ok($$ select public.record_spam_refusal(repeat('5d', 32), 'captcha') $$, 'PT422', null,
  'only the three metrics-spec reasons exist');

-- ---- sign-in limit per email: 5 failures in 15 minutes → 5-minute pause ----------------------
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('e5', 32), repeat('0e', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 20)), 5::bigint,
  '20 parallel guesses for one email reach Supabase Auth only 5 times');
select is((select count(*) from public.sign_in_attempts where email_hash = repeat('e5', 32)), 5::bigint,
  'refused attempts during the pause are not counted');
select ok((public.take_sign_in_attempt(repeat('e5', 32), repeat('0e', 32)) ->> 'retry_after_seconds')::integer between 1 and 300,
  'AC-004.5: the email pause lasts 5 minutes from the 5th failure');
select is((public.take_sign_in_attempt(repeat('e5', 32), repeat('0f', 32)) ->> 'allowed')::boolean, false,
  'the email pause holds from any network address');

-- 5 minutes later: the pause has ended and the count restarts (AC-004.5). Time is moved back as
-- the table owner (the server role has no update on sign_in_pauses).
reset role;
update public.sign_in_attempts set created_at = created_at - interval '6 minutes' where email_hash = repeat('e5', 32);
update public.sign_in_pauses set paused_until = paused_until - interval '6 minutes' where key_hash = repeat('e5', 32);
set local role service_role;
select is((public.take_sign_in_attempt(repeat('e5', 32), repeat('0e', 32)) ->> 'allowed')::boolean, true,
  'AC-004.5: after the pause the next attempt goes through, although the 5 old failures are within 15 minutes');
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('e5', 32), repeat('0e', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 10)), 4::bigint,
  'the count restarted at the end of the pause: 5 new failures in all, then paused again');

select ok(public.mark_sign_in_succeeded((public.take_sign_in_attempt(repeat('f6', 32), repeat('1e', 32)) ->> 'attempt_id')::uuid),
  'a staff sign-in marks its attempt as succeeded');
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('f6', 32), repeat('1e', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 5)), 5::bigint,
  'a successful attempt is not a failure: 5 more attempts are still allowed');
select is((public.take_sign_in_attempt(repeat('f6', 32), repeat('1e', 32)) ->> 'allowed')::boolean, false,
  'the 6th attempt after 5 failures is paused');

insert into public.sign_in_attempts (email_hash, ip_hash, succeeded, created_at)
select repeat('a8', 32), repeat('2e', 32), false, now() - interval '16 minutes' from generate_series(1, 5);
select is((public.take_sign_in_attempt(repeat('a8', 32), repeat('2e', 32)) ->> 'allowed')::boolean, true,
  'failures older than 15 minutes no longer pause');

-- AC-004.12: an email with no account is only a hash here, counted and paused exactly the same way
select is((select count(*) filter (where (public.take_sign_in_attempt(repeat('9c', 32), repeat('3e', 32)) ->> 'allowed')::boolean)
             from generate_series(1, 6)), 5::bigint,
  'AC-004.12: an unknown email is paused after 5 failures like a real one');

-- ---- sign-in limit per address: 20 failures in 15 minutes → 15-minute pause (AC-004.11) ------
select is((select count(*) filter (where (public.take_sign_in_attempt(
               repeat(md5('email-' || (g % 5)), 2), repeat('4f', 32)) ->> 'allowed')::boolean)
             from generate_series(0, 19) g), 20::bigint,
  '20 failures from one address over 5 emails with 4 each: none of them reaches the per-email limit');
select is((public.take_sign_in_attempt(repeat('0a', 32), repeat('4f', 32)) ->> 'allowed')::boolean, false,
  'AC-004.11: the 21st attempt from that address is refused, with an email that has no failures');
select ok((public.take_sign_in_attempt(repeat('0a', 32), repeat('4f', 32)) ->> 'retry_after_seconds')::integer between 301 and 900,
  'the address pause lasts 15 minutes');
select is((public.take_sign_in_attempt(repeat('0a', 32), repeat('4e', 32)) ->> 'allowed')::boolean, true,
  'AC-004.11: the same email from another address goes through');
select is((select count(*) from public.sign_in_pauses where scope = 'ip' and key_hash = repeat('4f', 32)), 1::bigint,
  'one address pause is recorded, kept in the database for every server instance');

reset role;
update public.sign_in_attempts set created_at = created_at - interval '16 minutes' where ip_hash = repeat('4f', 32);
update public.sign_in_pauses set paused_until = paused_until - interval '16 minutes' where key_hash = repeat('4f', 32);
set local role service_role;
select is((public.take_sign_in_attempt(repeat('0b', 32), repeat('4f', 32)) ->> 'allowed')::boolean, true,
  'after 15 minutes the address may sign in again and its count restarts');

-- ---- fail closed (AC-004.13) -----------------------------------------------------------------
select throws_ok($$ select public.take_sign_in_attempt(repeat('0c', 32), null) $$, 'PT422', null,
  'without an address key the counters cannot be used: an error (the route answers 503 sign_in_unavailable), never a silent allow');
select throws_ok($$ select public.take_sign_in_attempt(null, repeat('4d', 32)) $$, 'PT422', null,
  'without an email key: an error, never a silent allow');

reset role;

select * from finish();
rollback;
