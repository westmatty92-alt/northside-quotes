-- RLS: public.quote_photos (FR-7, US-002, US-005).
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

insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, photo_count, submitted_at)
values
  ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'submitted', 'NQ-7K3M9P', 'Dana Whitfield', '9055550142',
   'dana@example.com', '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', 2, now());
insert into public.quote_photos (request_id, position, storage_path, content_type, size_bytes) values
  ('c0000000-0000-4000-8000-000000000001', 1, 'c0000000-0000-4000-8000-000000000001/photo-1', 'image/jpeg', 2097152),
  ('c0000000-0000-4000-8000-000000000001', 2, 'c0000000-0000-4000-8000-000000000001/photo-2', 'image/png', 5242880);

select ok((select relrowsecurity from pg_class where oid = 'public.quote_photos'::regclass), 'quote_photos: RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.quote_photos'::regclass), 'quote_photos: RLS is forced');
select throws_ok($$ insert into public.quote_photos (request_id, position, storage_path, content_type, size_bytes)
                    values ('c0000000-0000-4000-8000-000000000001', 3, 'c0000000-0000-4000-8000-000000000001/photo-3', 'image/jpeg', 5242881) $$,
  '23514', null, 'a photo over 5,242,880 bytes violates the size check (FR-6)');
select throws_ok($$ insert into public.quote_photos (request_id, position, storage_path, content_type, size_bytes)
                    values ('c0000000-0000-4000-8000-000000000001', 3, 'c0000000-0000-4000-8000-000000000001/photo-3', 'application/pdf', 100) $$,
  '23514', null, 'a PDF violates the content type check (FR-6)');

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.quote_photos), 2::bigint, 'staff see the photos of a submitted request');
select throws_ok($$ delete from public.quote_photos $$, '42501', null, 'staff cannot delete photos');
select throws_ok($$ update public.quote_photos set size_bytes = 1 $$, '42501', null, 'staff cannot change photo rows');
reset role;

set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.quote_photos), 0::bigint, 'a non-staff user sees no photo rows');
reset role;

set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select throws_ok($$ select count(*) from public.quote_photos $$, '42501', null, 'anon cannot read photo rows');
reset role;

select * from finish();
rollback;
