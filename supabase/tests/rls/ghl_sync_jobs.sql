-- RLS: public.ghl_sync_jobs (FR-15, FR-24, US-010, US-017). Staff read sync state; only the
-- server (service role) and the RPCs write it.
begin;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'stranger@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now(), now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');
insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, submitted_at)
values
  ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'submitted', 'NQ-7K3M9P', 'Dana Whitfield', '9055550142',
   'dana@example.com', '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', now());
insert into public.ghl_sync_jobs (request_id, kind) values ('c0000000-0000-4000-8000-000000000001', 'contact_copy');

select ok((select relrowsecurity from pg_class where oid = 'public.ghl_sync_jobs'::regclass), 'ghl_sync_jobs: RLS is enabled');
select throws_ok($$ insert into public.ghl_sync_jobs (request_id, kind) values ('c0000000-0000-4000-8000-000000000001', 'contact_copy') $$,
  '23505', null, 'a second contact copy job for the same request is refused (FR-15)');
select throws_ok($$ insert into public.ghl_sync_jobs (request_id, kind) values ('c0000000-0000-4000-8000-000000000001', 'stage_tag') $$,
  '23514', null, 'a stage-tag job needs its target status');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.ghl_sync_jobs), 1::bigint, 'staff read sync state');
select throws_ok($$ update public.ghl_sync_jobs set state = 'succeeded' $$, '42501', null, 'staff cannot mark a copy as done');
select throws_ok($$ insert into public.ghl_sync_jobs (request_id, kind, target_status) values ('c0000000-0000-4000-8000-000000000001', 'stage_tag', 'won') $$,
  '42501', null, 'staff cannot insert jobs directly');
select throws_ok($$ select public.finish_ghl_job(gen_random_uuid(), 'succeeded', null, null) $$, '42501', null, 'staff cannot call finish_ghl_job');
reset role;

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.ghl_sync_jobs), 0::bigint, 'a non-staff user reads no sync state');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.ghl_sync_jobs $$, '42501', null, 'anon cannot read sync state');
reset role;

select * from finish();
rollback;
