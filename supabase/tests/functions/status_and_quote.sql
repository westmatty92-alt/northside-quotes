-- Behaviour: save_quote_request_quote, change_quote_request_status and request_ghl_copy_retry
-- (FR-11, FR-12, FR-19, FR-24, AC-006.3, AC-006.5, AC-007.4, AC-007.7, AC-014.4, AC-016.12,
-- AC-017.5, AC-017.6, AC-017.16). c...01 ticked the offers box; c...09 did not (ruling 1B).
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'helper@example.com', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now(), now());
insert into public.staff (user_id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Owner'),
  ('a0000000-0000-4000-8000-000000000002', 'Office helper');
insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, submitted_at,
   marketing_consent, marketing_consent_at)
values
  ('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'submitted', 'NQ-7K3M9P', 'Dana Whitfield', '9055550142',
   'dana@example.com', '14 Barton St W, Hamilton ON', 'Kitchen tap drips constantly', 'soon', now() - interval '90 minutes',
   true, now() - interval '90 minutes'),
  ('c0000000-0000-4000-8000-000000000009', gen_random_uuid(), 'submitted', 'NQ-9WXY23', 'Dana Whitfield', '9055550142',
   'dana@example.com', '9 King St E, Hamilton ON', 'Second job, offers box left unticked', 'flexible', now() - interval '30 minutes',
   false, null);

-- helper saves a price first (version 1 -> 2)
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000002"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', 45000, null, 1) ->> 'version')::integer, 2,
  'helper saves $450.00; version becomes 2');
select throws_ok($$ select public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', 0, null, 2) $$,
  'PT422', null, 'price 0 is refused (AC-006.3)');
select throws_ok($$ select public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', 10000000, null, 2) $$,
  'PT422', null, 'price 100,000.00 is refused (AC-006.3)');
select throws_ok($$ select public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', null, repeat('x', 1001), 2) $$,
  'PT422', null, 'a 1,001-character note is refused (AC-006.4)');
reset role;

-- owner still holds version 1: refused, helper's price kept (AC-006.5)
set local "request.jwt.claims" to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-000000000001"}';
set local "request.jwt.claim.sub" to 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$ select public.save_quote_request_quote('c0000000-0000-4000-8000-000000000001', null, 'Replace cartridge', 1) $$,
  'PT409', null, 'a save over a newer change is refused (AC-006.5)');
select is((select price_cents from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000001'), 45000::bigint,
  'the helper''s price is not overwritten');

-- status: new -> won with the current version
select is((public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'won', 2) ->> 'changed'), 'true',
  'owner marks the request Won');
select is((public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'won', 3) ->> 'changed'), 'false',
  'selecting Won again changes nothing (AC-007.4)');
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'lost', 2) $$,
  'PT409', null, 'a move from a stale screen is refused (AC-016.12)');
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'archived', 3) $$,
  'PT422', null, 'only New, Quoted, Won and Lost exist (NG-14)');
-- an id that names no row (c...09 is a real request below, so it cannot stand in for "unknown")
select throws_ok($$ select public.change_quote_request_status('c0000000-0000-4000-8000-0000000000ff', 'won', 1) $$,
  'PT404', null, 'an unknown request is not found');
select is((public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'quoted', 3) ->> 'version')::integer, 4,
  'won -> quoted');
select is((public.change_quote_request_status('c0000000-0000-4000-8000-000000000001', 'lost', 4) ->> 'status'), 'lost',
  'quoted -> lost in quick succession');

-- AC-017.16: an unticked request's status is saved, and nothing is queued for GHL
select is((public.change_quote_request_status('c0000000-0000-4000-8000-000000000009', 'won', 1) ->> 'changed'), 'true',
  'the unticked request is marked Won');
select throws_ok($$ select public.request_ghl_copy_retry('c0000000-0000-4000-8000-000000000009') $$,
  'PT409', null, 'AC-014.4: a copy retry for an unticked request is refused (409 not_retryable)');
reset role;

select is((select count(*) from public.ghl_sync_jobs where request_id = 'c0000000-0000-4000-8000-000000000009'), 0::bigint,
  'AC-017.16, AC-014.4: no stage-tag push and no copy job exist for the unticked request');
select is((select count(*) from public.quote_request_status_changes where request_id = 'c0000000-0000-4000-8000-000000000009'), 1::bigint,
  'its status change is still stored and audited');

-- what was stored (as the table owner)
select is((select count(*) from public.quote_request_status_changes where request_id = 'c0000000-0000-4000-8000-000000000001'), 3::bigint,
  'three real changes stored, the repeat Won is not (AC-007.7)');
select is((select changed_by from public.quote_request_status_changes
             where request_id = 'c0000000-0000-4000-8000-000000000001' and to_status = 'won'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'the change records who made it');
select is((select count(*) from public.ghl_sync_jobs where request_id = 'c0000000-0000-4000-8000-000000000001'
             and kind = 'stage_tag' and state in ('pending', 'waiting')), 1::bigint,
  'only one stage-tag push is active after quick changes (AC-017.6)');
select is((select target_status from public.ghl_sync_jobs where request_id = 'c0000000-0000-4000-8000-000000000001'
             and kind = 'stage_tag' and state = 'pending'), 'lost', 'the active push targets the latest status');
-- scoped to this test's two requests, so real jobs and events on staging never change these
select is((select count(*) from public.ghl_sync_jobs
            where request_id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000009')
              and kind = 'stage_tag' and state = 'superseded'), 2::bigint,
  'earlier pushes are superseded');
select is((select count(*) from public.events where name = 'quote_request_quoted'
             and request_id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000009')), 1::bigint,
  'the first price fires quote_request_quoted once');
select ok((select (properties ->> 'minutes_since_submit')::integer between 89 and 91 from public.events
            where name = 'quote_request_quoted' and request_id = 'c0000000-0000-4000-8000-000000000001'),
  'minutes_since_submit is measured from submission');
select is((select count(*) from public.events where name = 'quote_request_status_changed'
             and request_id = 'c0000000-0000-4000-8000-000000000001'), 3::bigint,
  'one status event per real change');
select is((select last_staff_update_by from public.quote_requests where id = 'c0000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'last updated by the owner (US-015)');

select * from finish();
rollback;
