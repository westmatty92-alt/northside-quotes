-- RLS: public.staff and the is_staff() rule (FR-9, US-004).
-- Identities: owner and helper are staff with fresh sessions; "stranger" is an auth user with
-- no staff row (should never exist, sign-up is off); the owner's second session is 8 days old.
-- Each identity sets BOTH claim settings (request.jwt.claims and request.jwt.claim.sub).
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

select ok((select relrowsecurity from pg_class where oid = 'public.staff'::regclass), 'staff: RLS is enabled');

-- owner, fresh session
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.staff), 2::bigint, 'owner sees both staff rows');
select is((select display_name from public.current_staff()), 'Owner', 'current_staff() names the owner');
select throws_ok($$ insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000003', 'Intruder') $$,
  '42501', null, 'owner cannot add staff (no in-app user management)');
select throws_ok($$ update public.staff set display_name = 'Boss' $$, '42501', null, 'owner cannot rename staff');
reset role;

-- helper, fresh session: identical rights
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000002"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.staff), 2::bigint, 'helper sees both staff rows');
reset role;

-- owner with a session older than 7 days
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000004"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.staff), 0::bigint, 'an 8-day-old session sees nothing (7-day limit)');
select is((select count(*) from public.current_staff()), 0::bigint, 'current_staff() is empty for an 8-day-old session');
reset role;

-- owner token without a session_id claim
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.staff), 0::bigint, 'a token without session_id sees nothing (fails closed)');
reset role;

-- stranger: signed in, not staff
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.staff), 0::bigint, 'a non-staff user sees no staff rows');
reset role;

-- anonymous
set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.staff $$, '42501', null, 'anon has no access to staff');
select throws_ok($$ select * from public.current_staff() $$, '42501', null, 'anon cannot call current_staff()');
reset role;

select * from finish();
rollback;
