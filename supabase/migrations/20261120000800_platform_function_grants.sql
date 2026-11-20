-- 20261120000800_platform_function_grants.sql
-- Purpose: no function in public is executable by anon (docs/threat-model.md "Live checks for A2",
--          supabase/tests/rls/all_tables.sql test 9), including functions the hosted platform installs.
--
-- Found on the first staging apply (A2, 2026-11-20): the staging project was created with Supabase's
-- "automatically enable RLS on new tables" option. That installs the event trigger `ensure_rls`
-- (ddl_command_end) and its function public.rls_auto_enable(), owned by postgres, SECURITY DEFINER,
-- returning event_trigger. The project's default privileges then grant EXECUTE on it to anon,
-- authenticated and service_role. A function returning event_trigger cannot be called directly and
-- PostgREST does not expose it, so nothing was reachable. The invariant is still "no public function
-- executable by anon", and the threat model says "investigate, don't widen".
--
-- The event trigger keeps working: EXECUTE is not checked when an event trigger fires, and postgres
-- (owner) keeps EXECUTE. The local stack and a project created without that option have no such
-- function, so every statement is guarded. Earlier migrations had already applied to staging, so this is a
-- new migration, not an edit.

begin;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end;
$$;

commit;

-- rollback
-- begin;
-- do $$
-- begin
--   if to_regprocedure('public.rls_auto_enable()') is not null then
--     grant execute on function public.rls_auto_enable() to anon, authenticated, service_role;  -- the platform default
--   end if;
-- end;
-- $$;
-- commit;
