-- RLS: public.quote_request_status_changes, the append-only audit (FR-12, AC-007.7).
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
insert into public.quote_request_status_changes (request_id, from_status, to_status, changed_by)
values ('c0000000-0000-4000-8000-000000000001', 'new', 'quoted', 'a0000000-0000-4000-8000-000000000001');

select ok((select relrowsecurity from pg_class where oid = 'public.quote_request_status_changes'::regclass),
  'quote_request_status_changes: RLS is enabled');
select throws_ok($$ insert into public.quote_request_status_changes (request_id, from_status, to_status)
                    values ('c0000000-0000-4000-8000-000000000001', 'won', 'won') $$,
  '23514', null, 'a same-status row is not a change (AC-007.4)');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.quote_request_status_changes), 1::bigint, 'staff read the status history');
select throws_ok($$ insert into public.quote_request_status_changes (request_id, from_status, to_status)
                    values ('c0000000-0000-4000-8000-000000000001', 'quoted', 'won') $$,
  '42501', null, 'staff cannot forge an audit row');
select throws_ok($$ update public.quote_request_status_changes set to_status = 'lost' $$, '42501', null, 'staff cannot edit the audit');
select throws_ok($$ delete from public.quote_request_status_changes $$, '42501', null, 'staff cannot delete the audit');
reset role;

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.quote_request_status_changes), 0::bigint, 'a non-staff user reads no history');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.quote_request_status_changes $$, '42501', null, 'anon cannot read the history');
reset role;

select * from finish();
rollback;
