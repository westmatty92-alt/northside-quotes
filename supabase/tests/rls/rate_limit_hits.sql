-- RLS: public.rate_limit_hits (FR-8). Server only: no client role reads or writes it, and it
-- holds HMACs, never a raw network address.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.rate_limit_hits (ip_hash) values (repeat('ab', 32));

select ok((select relrowsecurity from pg_class where oid = 'public.rate_limit_hits'::regclass), 'rate_limit_hits: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.rate_limit_hits'::regclass), 'rate_limit_hits: RLS is forced');
select throws_ok($$ insert into public.rate_limit_hits (ip_hash) values ('203.0.113.7') $$, '23514', null, 'a raw network address is refused (HMAC only)');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$ select count(*) from public.rate_limit_hits $$, '42501', null, 'staff cannot read the rate-limit counter');
select throws_ok($$ delete from public.rate_limit_hits $$, '42501', null, 'staff cannot reset the rate-limit counter');
select throws_ok($$ select public.take_submission_slot(repeat('ab', 32)) $$, '42501', null, 'staff cannot take a rate-limit slot');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.rate_limit_hits $$, '42501', null, 'anon cannot read the rate-limit counter');
select throws_ok($$ delete from public.rate_limit_hits $$, '42501', null, 'anon cannot reset its own rate limit');
select throws_ok($$ select public.take_submission_slot(repeat('ab', 32)) $$, '42501', null, 'anon cannot call take_submission_slot');
reset role;

set local role service_role;
select is((select count(*) from public.rate_limit_hits where ip_hash = repeat('ab', 32)), 1::bigint,
  'the server (service role) reads the counter');  -- scoped to this test's row: real hits on staging never change it
reset role;

select * from finish();
rollback;
