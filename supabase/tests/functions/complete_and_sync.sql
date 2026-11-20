-- Behaviour: complete_quote_request, claim_ghl_job and finish_ghl_job (FR-2, FR-3, FR-15,
-- FR-24, AC-001.6, AC-009.3, AC-010.3, AC-017.11, S0 SEC-7), run as the server (service role).
-- Every settle passes the lease_id of its own claim, as the runner does.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
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

-- attempt 1: claim the copy job and fail it with a server error
select is((select count(*) from public.claim_ghl_job('c0000000-0000-4000-8000-000000000002')), 1::bigint, 'the copy job is claimed');
select ok((select lease_id is not null and locked_until > now() from public.ghl_sync_jobs where kind = 'contact_copy'),
  'the claim sets a lease id and a lease time');
select is((select count(*) from public.claim_ghl_job('c0000000-0000-4000-8000-000000000002')), 0::bigint, 'a leased job is not claimed twice');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'server_error')).state, 'waiting', 'attempt 1 failed: waiting to retry')
  from public.ghl_sync_jobs where kind = 'contact_copy';
select ok((select next_attempt_at > now() + interval '4 minutes' and lease_id is null and locked_until is null
             from public.ghl_sync_jobs where kind = 'contact_copy'),
  'the first retry waits about 5 minutes and the lease is released');

-- attempts 2 to 6: make the job due, claim it, settle it with that claim's lease
update public.ghl_sync_jobs set next_attempt_at = now() where kind = 'contact_copy';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'attempt 2 claimed');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'timeout')).attempt_count::integer, 2, 'attempt 2')
  from public.ghl_sync_jobs where kind = 'contact_copy';

update public.ghl_sync_jobs set next_attempt_at = now() where kind = 'contact_copy';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'attempt 3 claimed');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'timeout')).attempt_count::integer, 3, 'attempt 3')
  from public.ghl_sync_jobs where kind = 'contact_copy';

update public.ghl_sync_jobs set next_attempt_at = now() where kind = 'contact_copy';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'attempt 4 claimed');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'timeout')).attempt_count::integer, 4, 'attempt 4')
  from public.ghl_sync_jobs where kind = 'contact_copy';

update public.ghl_sync_jobs set next_attempt_at = now() where kind = 'contact_copy';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'attempt 5 claimed');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'timeout')).state, 'waiting', 'attempt 5 still waiting')
  from public.ghl_sync_jobs where kind = 'contact_copy';
select ok((select next_attempt_at < now() + interval '13 hours' from public.ghl_sync_jobs where kind = 'contact_copy'),
  'no gap between attempts is longer than 12 hours plus the cron interval');

update public.ghl_sync_jobs set next_attempt_at = now() where kind = 'contact_copy';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'attempt 6 claimed');
select is((public.finish_ghl_job(id, lease_id, 'retry', 'timeout')).state, 'failed', 'attempt 6 (the 5th retry) fails for good (AC-010.3)')
  from public.ghl_sync_jobs where kind = 'contact_copy';
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
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'stage_tag'))), 1::bigint, 'the stage tag is claimed');
select is((public.finish_ghl_job(id, lease_id, 'abandon')).state, 'failed', 'stage tag fails when the copy has failed (FR-24)')
  from public.ghl_sync_jobs where kind = 'stage_tag';
reset role;
-- the same update request_ghl_copy_retry makes (that RPC needs a staff session; here the owner makes it)
update public.ghl_sync_jobs set state = 'waiting', max_attempts = attempt_count + 1, next_attempt_at = now()
 where kind = 'contact_copy';
set local role service_role;
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where kind = 'contact_copy'))), 1::bigint, 'the manual retry claims the copy');
select throws_ok($$ select public.finish_ghl_job(id, lease_id, 'succeeded', null, 'abc/../locations') from public.ghl_sync_jobs where kind = 'contact_copy' $$,
  '23514', null, 'a contact id with path characters is never stored (S0 SEC-12)');
select is((public.finish_ghl_job(id, lease_id, 'succeeded', null, 'ghl-contact-123')).state, 'succeeded', 'a manual retry succeeds')
  from public.ghl_sync_jobs where kind = 'contact_copy';
select is((select ghl_contact_id from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000002'), 'ghl-contact-123',
  'the contact id is stored as the link key');
select is((select state from public.ghl_sync_jobs where kind = 'stage_tag'), 'superseded',
  'the abandoned stage tag no longer applies once the contact exists with the current tag');

-- a rejected token fails at once, without retries (AC-017.10)
reset role;
insert into public.ghl_sync_jobs (request_id, kind, target_status)
values ('c0000000-0000-4000-8000-000000000002', 'stage_tag', 'lost');
set local role service_role;
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where target_status = 'lost'))), 1::bigint, 'the lost tag is claimed');
select is((public.finish_ghl_job(id, lease_id, 'failed', 'auth')).state, 'failed', 'a rejected token fails the push at once')
  from public.ghl_sync_jobs where target_status = 'lost';
select is((select count(*) from public.events where name = 'ghl_tag_sync_gave_up'), 0::bigint, 'a token failure is not a gave-up');
reset role;

-- S0 SEC-7: runner A's lease expires, runner B claims the job; A's late result changes nothing
insert into public.ghl_sync_jobs (request_id, kind, target_status)
values ('c0000000-0000-4000-8000-000000000002', 'stage_tag', 'quoted');
set local role service_role;
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where target_status = 'quoted'))), 1::bigint,
  'runner A claims the job');
select ok(set_config('nq_test.lease_a', (select lease_id::text from public.ghl_sync_jobs where target_status = 'quoted'), true) is not null,
  'remember runner A''s lease id');
update public.ghl_sync_jobs set locked_until = now() - interval '1 second' where target_status = 'quoted';
select is((select count(*) from public.claim_ghl_job(null, (select id from public.ghl_sync_jobs where target_status = 'quoted'))), 1::bigint,
  'runner B claims it after A''s lease expired');
select isnt((select lease_id::text from public.ghl_sync_jobs where target_status = 'quoted'), current_setting('nq_test.lease_a'),
  'runner B holds a new lease id');
select is((public.finish_ghl_job(id, current_setting('nq_test.lease_a')::uuid, 'succeeded')).state, 'pending',
  'runner A''s late result is ignored') from public.ghl_sync_jobs where target_status = 'quoted';
select is((public.finish_ghl_job(id, null, 'retry', 'timeout')).state, 'pending',
  'a result without a lease id is ignored') from public.ghl_sync_jobs where target_status = 'quoted';
select is((select attempt_count::integer from public.ghl_sync_jobs where target_status = 'quoted'), 0,
  'no attempt was counted for the ignored results');
select is((select count(*) from public.events where name in ('ghl_tag_sync_succeeded', 'ghl_tag_sync_attempt_failed')
             and properties ->> 'to_status' = 'quoted'), 0::bigint, 'and no event was recorded');
select is((public.finish_ghl_job(id, lease_id, 'succeeded')).state, 'succeeded', 'runner B settles it with its own lease')
  from public.ghl_sync_jobs where target_status = 'quoted';
select is((select count(*) from public.events where name = 'ghl_tag_sync_succeeded' and properties ->> 'to_status' = 'quoted'), 1::bigint,
  'exactly one success event');
reset role;

-- one claim leases exactly one job, contact copies first (S0 SEC-7)
insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, submitted_at)
values
  ('c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'submitted', 'NQ-QWER23', 'Alex Two', '9055550198',
   'alex@example.com', '21 King St E, Hamilton ON', 'Water heater makes a banging noise', 'soon', now());
insert into public.ghl_sync_jobs (request_id, kind, target_status) values
  ('c0000000-0000-4000-8000-000000000003', 'stage_tag', 'quoted'),
  ('c0000000-0000-4000-8000-000000000003', 'contact_copy', null);
set local role service_role;
select is((select kind from public.claim_ghl_job()), 'contact_copy', 'a claim takes one job, the contact copy first');
select is((select count(*) from public.ghl_sync_jobs where request_id = 'c0000000-0000-4000-8000-000000000003' and lease_id is not null), 1::bigint,
  'only that one job is leased');
reset role;

select * from finish();
rollback;
