-- RLS: public.sign_in_attempts (FR-9 pause after 5 failures). Server only; emails stored as HMACs.
begin;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.sign_in_attempts (email_hash, succeeded) values (repeat('cd', 32), false);

select ok((select relrowsecurity from pg_class where oid = 'public.sign_in_attempts'::regclass), 'sign_in_attempts: RLS is enabled');
select throws_ok($$ insert into public.sign_in_attempts (email_hash, succeeded) values ('owner@example.com', false) $$,
  '23514', null, 'a raw email is refused (HMAC only)');

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
reset role;

set local role service_role;
select is((select count(*) from public.sign_in_attempts), 1::bigint, 'the server (service role) reads the attempts');
reset role;

select * from finish();
rollback;
