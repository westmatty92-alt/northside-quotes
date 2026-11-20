-- RLS: public.events (FR-21, metrics spec Destinations: readable only by the two signed-in staff).
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'stranger@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
-- Counts below are scoped to this test's own rows, so real events on staging never change them.
-- Assertions that expect 0 for a role that may read nothing stay unscoped (stronger).
insert into public.events (id, name, properties) values
  ('e0000000-0000-4000-8000-000000000001', 'spam_submission_blocked', '{"reason":"honeypot"}');

select ok((select relrowsecurity from pg_class where oid = 'public.events'::regclass), 'events: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.events'::regclass), 'events: RLS is forced');
select throws_ok($$ insert into public.events (name) values ('page_viewed') $$, '23514', null, 'only events from the metrics spec are accepted');
select throws_ok($$ insert into public.events (name, properties) values ('spam_submission_blocked', '{"reason":"honeypot","email":"x@example.com"}') $$,
  '23514', null, 'a property outside the metrics spec (here: email) is refused (S0 SEC-9)');
select lives_ok($$ insert into public.events (name, properties) values ('photo_upload_failed', '{"reason":"bad_type","photo_index":2}') $$,
  'metrics-spec properties are accepted');
delete from public.events where name = 'photo_upload_failed' and created_at = now();  -- now() is this transaction's start: only the row above

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.events where id = 'e0000000-0000-4000-8000-000000000001'), 1::bigint, 'staff read events');
select throws_ok($$ insert into public.events (name) values ('staff_signed_in') $$, '42501', null, 'staff cannot write events directly');
select throws_ok($$ delete from public.events $$, '42501', null, 'staff cannot delete events');
reset role;

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.events), 0::bigint, 'a non-staff user reads no events');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.events $$, '42501', null, 'anon cannot read events');
select throws_ok($$ insert into public.events (name) values ('spam_submission_blocked') $$, '42501', null, 'anon cannot write events');
reset role;

select * from finish();
rollback;
