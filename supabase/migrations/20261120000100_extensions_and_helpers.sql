-- 20261120000100_extensions_and_helpers.sql
-- Purpose: pgcrypto (random reference numbers), the app_private schema for helper functions that
--          PostgREST must not expose, and the shared updated_at trigger function. Serves every
--          later migration.
--          pgTAP is NOT installed here (S0 SEC-18): its functions execute SQL text and must never
--          live in production. Each file in supabase/tests/ installs it inside its own transaction
--          and the final rollback removes it again.
-- Decision: docs/decisions/0001-stack.md, docs/decisions/0003-staff-auth-sessions-and-writes.md

begin;

create extension if not exists pgcrypto with schema extensions;

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
-- commit;                               -- pgcrypto stays: Supabase installs it by default
