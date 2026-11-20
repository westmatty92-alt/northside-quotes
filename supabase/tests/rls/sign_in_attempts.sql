-- RLS: public.sign_in_attempts (FR-9 limits per email and per network address, ruling 4A).
-- Server only; emails and addresses stored as HMACs.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.sign_in_attempts (email_hash, ip_hash, succeeded) values (repeat('cd', 32), repeat('ce', 32), false);

select ok((select relrowsecurity from pg_class where oid = 'public.sign_in_attempts'::regclass), 'sign_in_attempts: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.sign_in_attempts'::regclass), 'sign_in_attempts: RLS is forced');
select throws_ok($$ insert into public.sign_in_attempts (email_hash, ip_hash, succeeded) values ('owner@example.com', repeat('ce', 32), false) $$,
  '23514', null, 'a raw email is refused (HMAC only)');
select throws_ok($$ insert into public.sign_in_attempts (email_hash, ip_hash, succeeded) values (repeat('cd', 32), '203.0.113.7', false) $$,
  '23514', null, 'a raw network address is refused (HMAC only)');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$ select count(*) from public.sign_in_attempts $$, '42501', null, 'staff cannot read sign-in attempts');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.sign_in_attempts $$, '42501', null, 'anon cannot read sign-in attempts');
select throws_ok($$ delete from public.sign_in_attempts $$, '42501', null, 'anon cannot clear a sign-in pause');
select throws_ok($$ select public.take_sign_in_attempt(repeat('cd', 32), repeat('ce', 32)) $$, '42501', null, 'anon cannot call take_sign_in_attempt');
select throws_ok($$ select public.mark_sign_in_succeeded(gen_random_uuid()) $$, '42501', null, 'anon cannot mark an attempt as succeeded');
reset role;

set local role service_role;
select is((select count(*) from public.sign_in_attempts), 1::bigint, 'the server (service role) reads the attempts');
reset role;

select * from finish();
rollback;
