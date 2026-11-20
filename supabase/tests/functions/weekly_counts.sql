-- Behaviour: weekly count rules (FR-13, AC-008.1, AC-008.3, AC-008.4, AC-008.5, AC-008.6).
-- Runs app_private.weekly_counts_at as the table owner with a fixed "now".
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

insert into public.quote_requests
  (id, submission_key, state, reference, name, phone, email, address, problem, urgency, status, status_changed_at, submitted_at)
values
  -- Sunday 23:59:59 the week before: not this week (AC-008.3)
  ('f0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'submitted', 'NQ-AAAAA2', 'Sunday Late', '9055550111',
   's1@example.com', '1 Main St W, Hamilton', 'Sunday night leak test', 'soon', 'new', null,
   '2026-11-15 23:59:59 America/Toronto'),
  -- Monday 00:00:00: this week (AC-008.3)
  ('f0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'submitted', 'NQ-AAAAA3', 'Monday Early', '9055550112',
   's2@example.com', '2 Main St W, Hamilton', 'Monday morning leak test', 'soon', 'new', null,
   '2026-11-16 00:00:00 America/Toronto'),
  -- submitted last week, won this week: Won yes, Requests no (AC-008.4)
  ('f0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'submitted', 'NQ-AAAAA4', 'Won Later', '9055550113',
   's3@example.com', '3 Main St W, Hamilton', 'Old request won this week', 'soon', 'won', '2026-11-17 10:00 America/Toronto',
   '2026-11-10 09:00 America/Toronto'),
  -- won Tuesday then lost Wednesday: Lost only (AC-008.5)
  ('f0000000-0000-4000-8000-000000000004', gen_random_uuid(), 'submitted', 'NQ-AAAAA5', 'Won Then Lost', '9055550114',
   's4@example.com', '4 Main St W, Hamilton', 'Changed its mind midweek', 'soon', 'lost', '2026-11-18 11:00 America/Toronto',
   '2026-11-16 08:00 America/Toronto'),
  -- pending requests never count
  ('f0000000-0000-4000-8000-000000000005', gen_random_uuid(), 'pending', null, 'Not Yet', '9055550115',
   's5@example.com', '5 Main St W, Hamilton', 'Still uploading photos', 'soon', 'new', null, null);

select is((select requests from app_private.weekly_counts_at('2026-11-19 12:00 America/Toronto')), 2::bigint,
  'Requests this week counts Monday 00:00:00 and later, by submitted time');
select is((select won from app_private.weekly_counts_at('2026-11-19 12:00 America/Toronto')), 1::bigint,
  'Won counts a request won this week even if submitted last week');
select is((select lost from app_private.weekly_counts_at('2026-11-19 12:00 America/Toronto')), 1::bigint,
  'Won then Lost in the same week counts only as Lost');
select is((select week_start from app_private.weekly_counts_at('2026-11-19 12:00 America/Toronto')),
  '2026-11-16 00:00:00 America/Toronto'::timestamptz, 'the week starts Monday 00:00 Hamilton time');
select is((select week_start from app_private.weekly_counts_at('2026-10-29 12:00 America/Toronto')),
  '2026-10-26 04:00:00+00'::timestamptz, 'DST week starts Monday 2026-10-26 00:00 EDT (AC-008.6)');
select is((select week_end from app_private.weekly_counts_at('2026-10-29 12:00 America/Toronto')),
  '2026-11-02 05:00:00+00'::timestamptz, 'DST week ends at Monday 2026-11-02 00:00 EST, after Sunday 23:59:59');
select is((select requests + won + lost from app_private.weekly_counts_at('2026-12-02 12:00 America/Toronto')), 0::bigint,
  'a week with no activity shows 0, 0, 0 (AC-008.7)');

select * from finish();
rollback;
