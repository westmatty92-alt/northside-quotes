-- Behaviour: complete_quote_request, claim_ghl_jobs and finish_ghl_job (FR-2, FR-3, FR-15,
-- FR-24, AC-001.6, AC-009.3, AC-010.3, AC-017.11), run as the server (service role).
begin;
select no_plan();

insert into public.quote_requests
  (id, submission_key, state, name, phone, email, address, problem, urgency, photo_count)
values
  ('c0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'pending', 'Sam Pending', '9055550199',
   'sam@example.com', '20 King St E, Hamilton ON', 'Basement drain is backing up', 'emergency', 2);

set local role service_role;

select throws_ok($$ select public.complete_quote_request('c0000000-0000-4000-8000-000000000002',
                    '[{"position":1,"storage_path":"c0000000-0000-4000-8000-000000000002/photo-1","content_type":"image/jpeg","size_bytes":1000}]') $$,
  'PT422', null, 'photos must match the planned count');

select ok((public.complete_quote_request('c0000000-0000-4000-8000-000000000002',
  '[{"position":1,"storage_path":"c0000000-0000-4000-8000-000000000002/photo-1","content_type":"image/jpeg","size_bytes":2097152},
    {"position":2,"storage_path":"c0000000-0000-4000-8000-000000000002/photo-2","content_type":"image/webp","size_bytes":5242880}]')
  ->> 'reference') ~ '^NQ-[A-HJKMNP-Z2-9]{6}$', 'submission issues an NQ- reference (FR-2)');

select is((select state from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000002'), 'submitted', 'the request is submitted');
select is((public.complete_quote_request('c0000000-0000-4000-8000-000000000002', '[]') ->> 'reference'),
  (select reference from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000002'),
  'a repeated submit returns the same reference (AC-001.6)');
select is((select count(*) from public.quote_photos where request_id = 'c0000000-0000-4000-8000-000000000002'), 2::bigint, 'both photos stored');
select is((select count(*) from public.ghl_sync_jobs where request_id = 'c0000000-0000-4000-8000-000000000002' and kind = 'contact_copy'), 1::bigint,
  'one contact copy queued');
select is((select count(*) from public.events where name = 'quote_request_submitted'), 1::bigint, 'one submitted event');
select is((select properties ->> 'photo_count' from public.events where name = 'quote_request_submitted'), '2', 'event carries photo_count');

-- claim the copy job and fail it with a server error 6 times: 5 retries after the first attempt
select is((select count(*) from public.claim_ghl_jobs(10, 'c0000000-0000-4000-8000-000000000002', 120)), 1::bigint, 'the copy job is claimed');
select is((select count(*) from public.claim_ghl_jobs(10, 'c0000000-0000-4000-8000-000000000002', 120)), 0::bigint, 'a leased job is not claimed twice');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'server_error')).state,
  'waiting', 'attempt 1 failed: waiting to retry');
select ok((select next_attempt_at > now() + interval '4 minutes' from public.ghl_sync_jobs where kind = 'contact_copy'),
  'the first retry waits about 5 minutes');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'timeout')).attempt_count::integer, 2, 'attempt 2');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'timeout')).attempt_count::integer, 3, 'attempt 3');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'timeout')).attempt_count::integer, 4, 'attempt 4');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'timeout')).state, 'waiting', 'attempt 5 still waiting');
select ok((select next_attempt_at < now() + interval '13 hours' from public.ghl_sync_jobs where kind = 'contact_copy'),
  'no gap between attempts is longer than 12 hours plus the cron interval');
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'retry', 'timeout')).state, 'failed',
  'attempt 6 (the 5th retry) fails for good (AC-010.3)');
select is((select count(*) from public.events where name = 'ghl_sync_attempt_failed'), 6::bigint, 'six failed-attempt events');
select is((select count(*) from public.events where name = 'ghl_sync_gave_up'), 1::bigint, 'one gave-up event');
select ok((select not (properties ?| array['name', 'phone', 'email', 'address', 'token'])
             from public.events where name = 'ghl_sync_attempt_failed' limit 1),
  'failure events hold no personal data or token (AC-010.5)');
reset role;

-- a stage tag whose contact copy failed is abandoned, then superseded once a manual copy succeeds
insert into public.ghl_sync_jobs (request_id, kind, target_status)
values ('c0000000-0000-4000-8000-000000000002', 'stage_tag', 'won');
set local role service_role;
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'stage_tag'), 'abandon')).state, 'failed',
  'stage tag fails when the copy has failed (FR-24)');
reset role;
update public.ghl_sync_jobs set state = 'waiting', max_attempts = attempt_count + 1, next_attempt_at = now()
 where kind = 'contact_copy';
set local role service_role;
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'contact_copy'), 'succeeded', null, 'ghl-contact-123')).state,
  'succeeded', 'a manual retry succeeds');
select is((select ghl_contact_id from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000002'), 'ghl-contact-123',
  'the contact id is stored as the link key');
select is((select state from public.ghl_sync_jobs where kind = 'stage_tag'), 'superseded',
  'the abandoned stage tag no longer applies once the contact exists with the current tag');

-- a rejected token fails at once, without retries (AC-017.10)
reset role;
insert into public.ghl_sync_jobs (request_id, kind, target_status)
values ('c0000000-0000-4000-8000-000000000002', 'stage_tag', 'lost');
set local role service_role;
select is((public.finish_ghl_job((select id from public.ghl_sync_jobs where kind = 'stage_tag' and target_status = 'lost'), 'failed', 'auth')).state,
  'failed', 'a rejected token fails the push at once');
select is((select count(*) from public.events where name = 'ghl_tag_sync_gave_up'), 0::bigint, 'a token failure is not a gave-up');
reset role;

select * from finish();
rollback;
