-- 20261120000100_extensions_and_helpers.sql
-- Purpose: extensions (pgTAP for the RLS tests, pgcrypto for random reference numbers), the
--          app_private schema for helper functions that PostgREST must not expose, and the shared
--          updated_at trigger function. Serves every later migration.
-- Decision: docs/decisions/0001-stack.md, docs/decisions/0003-staff-auth-sessions-and-writes.md

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

-- Helper functions used by RLS policies live here. The schema is not in PostgREST's exposed
-- schemas, so nothing in it can be called over the REST API.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

-- updated_at that actually updates
create or replace function app_private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app_private.set_updated_at() from public;

commit;

-- rollback
-- begin;
-- drop function if exists app_private.set_updated_at();
-- drop schema if exists app_private;   -- only after every later migration has been rolled back
-- drop extension if exists pgtap;       -- pgcrypto stays: Supabase installs it by default
-- commit;
