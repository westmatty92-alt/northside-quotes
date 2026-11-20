-- RLS: public.sign_in_pauses (FR-9 pauses per email and per network address, ruling 4A).
-- Server only: no client role can read, clear or add a pause; keys are HMACs.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.sign_in_pauses (scope, key_hash, paused_until) values ('email', repeat('cd', 32), now() + interval '5 minutes');

select ok((select relrowsecurity from pg_class where oid = 'public.sign_in_pauses'::regclass), 'sign_in_pauses: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.sign_in_pauses'::regclass), 'sign_in_pauses: RLS is forced');
select throws_ok($$ insert into public.sign_in_pauses (scope, key_hash, paused_until) values ('email', 'owner@example.com', now()) $$,
  '23514', null, 'a raw email is refused (HMAC only)');
select throws_ok($$ insert into public.sign_in_pauses (scope, key_hash, paused_until) values ('account', repeat('cd', 32), now()) $$,
  '23514', null, 'only the email and address scopes exist');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$ select count(*) from public.sign_in_pauses $$, '42501', null, 'staff cannot read sign-in pauses');
select throws_ok($$ delete from public.sign_in_pauses $$, '42501', null, 'staff cannot clear a pause');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.sign_in_pauses $$, '42501', null, 'anon cannot read sign-in pauses');
select throws_ok($$ delete from public.sign_in_pauses $$, '42501', null, 'anon cannot lift its own pause');
select throws_ok($$ insert into public.sign_in_pauses (scope, key_hash, paused_until) values ('ip', repeat('ab', 32), now() + interval '1 day') $$,
  '42501', null, 'anon cannot pause someone else');
reset role;

set local role service_role;
select is((select count(*) from public.sign_in_pauses), 1::bigint, 'the server (service role) reads the pauses');
select throws_ok($$ update public.sign_in_pauses set paused_until = now() $$, '42501', null,
  'not even the server shortens a pause: it has no update privilege');
reset role;

select * from finish();
rollback;
