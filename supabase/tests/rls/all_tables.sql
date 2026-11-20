-- RLS across every table in public, plus the role attributes the design relies on (S0 SEC-1,
-- SEC-17). This file covers tables added later too, not only today's eight.
--
-- If the BYPASSRLS assertions fail on any database: STOP and raise a contract question. Never
-- drop "force row level security" to make them pass. The staff RPCs, is_staff(), current_staff()
-- and photo_upload_allowed() are security definer functions owned by postgres and need it; the
-- service-role functions are security invoker and need service_role's attribute.
begin;
create extension if not exists pgtap with schema extensions;  -- test-only; removed again by the rollback (S0 SEC-18)
select no_plan();

select ok((select rolbypassrls from pg_roles where rolname = 'postgres'),
  'postgres (owner of the tables and of the security definer functions) has BYPASSRLS');
select ok((select rolbypassrls from pg_roles where rolname = 'service_role'),
  'service_role (the security invoker server functions) has BYPASSRLS');
select ok((select c.relowner = (select oid from pg_roles where rolname = 'postgres')
             from pg_class c where c.oid = 'public.quote_requests'::regclass),
  'the tables are owned by postgres (the role checked above)');

select is((select count(*)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and not (c.relrowsecurity and c.relforcerowsecurity)),
  0::bigint, 'every table in public has RLS enabled AND forced');

select is((select count(*)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  0::bigint, 'every table in public has at least one policy');

select is((select count(*)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  0::bigint, 'anon holds no privilege on any table in public');

select is((select count(*)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  0::bigint, 'authenticated can only select from tables in public (writes go through RPCs)');

select is((select count(*)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and c.relname in ('rate_limit_hits', 'sign_in_attempts')
              and has_table_privilege('authenticated', c.oid, 'SELECT')),
  0::bigint, 'authenticated cannot even select the two counters');

select is((select count(*)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint, 'anon can execute no function in public');

select is((select count(*)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('start_quote_request', 'take_submission_slot', 'take_sign_in_attempt',
                                'mark_sign_in_succeeded', 'complete_quote_request', 'claim_ghl_job', 'finish_ghl_job')
              and p.prosecdef),
  0::bigint, 'the service-role functions are security invoker (they do not depend on the owner bypassing RLS)');

select * from finish();
rollback;
