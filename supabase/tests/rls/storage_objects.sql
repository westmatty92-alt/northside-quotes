-- RLS: storage.objects in the private quote-photos bucket (FR-6, FR-7, US-002, AC-002.8).
-- Anonymous homeowners may insert only into their own pending request's folder, only planned
-- positions, at most 3 photos; only staff read; no client updates or deletes.
-- Inserts below go through RLS exactly as the Storage API does for an upload with the public key.
begin;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'stranger@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now(), now()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', now() - interval '8 days', now());
insert into public.staff (user_id, display_name) values ('a0000000-0000-4000-8000-000000000001', 'Owner');

-- d...01 pending, plans 3 photos · d...02 pending, plans 1 photo · d...03 submitted
-- d...04 pending but created 2 hours ago (upload window is 60 minutes)
insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, photo_count, submitted_at, created_at)
values
  ('d0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'pending', null, 'Pat Three', '9055550101',
   'pat@example.com', '1 James St N, Hamilton ON', 'Water heater leaking at the base', 'emergency', 3, null, now()),
  ('d0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'pending', null, 'Lee One', '9055550102',
   'lee@example.com', '2 James St N, Hamilton ON', 'Toilet keeps running all night', 'soon', 1, null, now()),
  ('d0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'submitted', 'NQ-ABCD23', 'Kim Done', '9055550103',
   'kim@example.com', '3 James St N, Hamilton ON', 'Outdoor tap is frozen and cracked', 'flexible', 0, now(), now()),
  ('d0000000-0000-4000-8000-000000000004', gen_random_uuid(), 'pending', null, 'Old Pending', '9055550104',
   'old@example.com', '4 James St N, Hamilton ON', 'Slow drain in the upstairs bathroom', 'flexible', 3, null, now() - interval '2 hours');

-- The bucket exists, is private, and enforces size and type (AC-002.9)
select is((select public from storage.buckets where id = 'quote-photos'), false, 'quote-photos bucket is private');
select is((select file_size_limit from storage.buckets where id = 'quote-photos'), 5242880::bigint, 'bucket limit is 5,242,880 bytes');
select is((select allowed_mime_types from storage.buckets where id = 'quote-photos'),
  array['image/jpeg', 'image/png', 'image/webp']::text[], 'bucket accepts JPEG, PNG and WebP only');
select is((select count(*) from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname like 'nq_quote_photos%'
              and cmd in ('UPDATE', 'DELETE', 'ALL')), 0::bigint, 'no client policy updates or deletes photos');

-- anonymous homeowner
set local "request.jwt.claims" to '';
set local "request.jwt.claim.sub" to '';
set local role anon;
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000001/photo-1') $$,
  'anon uploads photo 1 into its own pending folder');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000001/photo-2') $$,
  'anon uploads photo 2');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000001/photo-3') $$,
  'anon uploads photo 3');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000001/photo-4') $$,
  '42501', null, 'a 4th photo is refused (AC-002.2)');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000001/extra.jpg') $$,
  '42501', null, 'any other file name is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000002/photo-2') $$,
  '42501', null, 'a position beyond the planned photo count is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000003/photo-1') $$,
  '42501', null, 'the folder of a submitted request is closed');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000004/photo-1') $$,
  '42501', null, 'the folder of a pending request older than 60 minutes is closed');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'e0000000-0000-4000-8000-000000000009/photo-1') $$,
  '42501', null, 'a folder that is not a pending request is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'photo-1') $$,
  '42501', null, 'an upload outside any request folder is refused');
select is((select count(*) from storage.objects where bucket_id = 'quote-photos'), 0::bigint,
  'anon cannot list or read photos, not even its own (AC-002.8)');
reset role;

-- staff, fresh session
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'quote-photos'), 3::bigint, 'staff can read the photos');
reset role;

-- staff, session older than 7 days
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000004"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'quote-photos'), 0::bigint, 'an 8-day-old session reads no photos');
reset role;

-- signed in, not staff
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000003"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'quote-photos'), 0::bigint, 'a non-staff user reads no photos');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('quote-photos', 'd0000000-0000-4000-8000-000000000002/photo-2') $$,
  '42501', null, 'a signed-in user is held to the same upload rule');
reset role;

select * from finish();
rollback;
