-- RLS: public.spam_refusal_windows (FR-8 cap on spam_submission_blocked events, S0 SEC-14).
-- Server only; the address key is an HMAC and lives here, never in events.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.events (id, name, properties) values
  ('d0000000-0000-4000-8000-000000000001', 'spam_submission_blocked', '{"reason":"honeypot","count":1}');
insert into public.spam_refusal_windows (ip_hash, reason, event_id) values
  (repeat('ab', 32), 'honeypot', 'd0000000-0000-4000-8000-000000000001');

select ok((select relrowsecurity from pg_class where oid = 'public.spam_refusal_windows'::regclass), 'spam_refusal_windows: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.spam_refusal_windows'::regclass), 'spam_refusal_windows: RLS is forced');
select throws_ok($$ insert into public.spam_refusal_windows (ip_hash, reason, event_id)
                    values ('203.0.113.7', 'honeypot', 'd0000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a raw network address is refused (HMAC only)');
select throws_ok($$ insert into public.spam_refusal_windows (ip_hash, reason, event_id)
                    values (repeat('ab', 32), 'bad_word', 'd0000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'only the metrics-spec reasons exist');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$ select count(*) from public.spam_refusal_windows $$, '42501', null, 'staff cannot read address keys');
-- counts are scoped to this test's event and window, so real refusals on staging never change them
select is((select count(*) from public.events where name = 'spam_submission_blocked' and id = 'd0000000-0000-4000-8000-000000000001'), 1::bigint,
  'staff read the capped event itself (it holds no address)');
select throws_ok($$ select public.record_spam_refusal(repeat('ab', 32), 'honeypot') $$, '42501', null,
  'staff cannot call record_spam_refusal');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.spam_refusal_windows $$, '42501', null, 'anon cannot read the windows');
select throws_ok($$ delete from public.spam_refusal_windows $$, '42501', null, 'anon cannot reset the windows');
select throws_ok($$ select public.record_spam_refusal(repeat('ab', 32), 'honeypot') $$, '42501', null,
  'anon cannot inflate the counts');
reset role;

set local role service_role;
select is((select count(*) from public.spam_refusal_windows where event_id = 'd0000000-0000-4000-8000-000000000001'), 1::bigint,
  'the server (service role) reads the windows');
select throws_ok($$ update public.events set name = 'staff_signed_in' where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the server can update only an event''s properties (its count), never its name');
reset role;

delete from public.events where id = 'd0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.spam_refusal_windows where event_id = 'd0000000-0000-4000-8000-000000000001'), 0::bigint,
  'a window goes with its event (cascade)');

select * from finish();
rollback;
