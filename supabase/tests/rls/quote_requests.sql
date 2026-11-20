-- RLS: public.quote_requests (FR-3, FR-7, FR-9, US-004, US-005, AC-004.8).
-- Staff see submitted requests only; pending ones are invisible; nobody writes the table directly.
begin;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'helper@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'stranger@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now(), now()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', now() - interval '8 days', now());
insert into public.staff (user_id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Owner'),
  ('a0000000-0000-4000-8000-000000000002', 'Office helper');

insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, photo_count, submitted_at)
values
  ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'submitted', 'NQ-7K3M9P', 'Dana Whitfield', '9055550142',
   'dana@example.com', '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 0, now()),
  ('c0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'pending', null, 'Sam Pending', '9055550199',
   'sam@example.com', '20 King St E, Hamilton ON', 'Basement drain is backing up', 'emergency', 2, null);

select ok((select relrowsecurity from pg_class where oid = 'public.quote_requests'::regclass), 'quote_requests: RLS is enabled');

-- owner
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.quote_requests), 1::bigint, 'owner sees the submitted request only');
select is((select count(*) from public.quote_requests where state = 'pending'), 0::bigint, 'owner never sees a pending request (FR-3)');
select throws_ok($$ update public.quote_requests set status = 'won' $$, '42501', null, 'owner cannot update the table directly (RPC only)');
select throws_ok($$ delete from public.quote_requests $$, '42501', null, 'owner cannot delete requests (NG-7)');
select throws_ok($$ insert into public.quote_requests (submission_key, name, phone, email, address, problem, urgency)
                    values (gen_random_uuid(), 'Fake Person', '9055550100', 'f@example.com', '1 Main St', 'Made up problem text', 'soon') $$,
  '42501', null, 'owner cannot insert requests directly');
reset role;

-- helper: identical rights
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000002"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.quote_requests), 1::bigint, 'helper sees the same requests as the owner (AC-004.2)');
reset role;

-- owner, session older than 7 days
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000004"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.quote_requests), 0::bigint, 'an 8-day-old session reads no requests');
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'won', 1) $$,
  'PT401', null, 'an 8-day-old session cannot change a status');
reset role;

-- stranger: signed in, not staff
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.quote_requests), 0::bigint, 'a non-staff user reads no requests');
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'won', 1) $$,
  'PT401', null, 'a non-staff user cannot change a status');
select throws_ok($$ select public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', 45000, 'note', 1) $$,
  'PT401', null, 'a non-staff user cannot save a price');
select throws_ok($$ select public.complete_quote_request('c0000000-0000-4000-8000-000000000002', '[]'::jsonb) $$,
  '42501', null, 'a signed-in user cannot complete a submission (service role only)');
select throws_ok($$ select * from public.claim_ghl_jobs(10, null, 120) $$,
  '42501', null, 'a signed-in user cannot claim sync jobs');
reset role;

-- anonymous (AC-004.8: no request data without sign-in)
set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.quote_requests $$, '42501', null, 'anon cannot read requests');
select throws_ok($$ insert into public.quote_requests (submission_key, name, phone, email, address, problem, urgency)
                    values (gen_random_uuid(), 'Bot Person', '9055550100', 'b@example.com', '1 Main St', 'Spam spam spam spam', 'soon') $$,
  '42501', null, 'anon cannot insert requests directly (spam checks cannot be skipped)');
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'won', 1) $$,
  '42501', null, 'anon cannot call change_quote_request_status');
select throws_ok($$ select public.complete_quote_request('c0000000-0000-4000-8000-000000000002', '[]'::jsonb) $$,
  '42501', null, 'anon cannot call complete_quote_request');
select throws_ok($$ select * from public.weekly_counts() $$, '42501', null, 'anon cannot read the weekly count');
reset role;

select * from finish();
rollback;
