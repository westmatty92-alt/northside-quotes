-- 20261120000200_staff.sql
-- Purpose: the two staff accounts (owner, office helper) with identical rights, and the
--          is_staff() check every staff policy uses: a staff row AND a Supabase Auth session
--          younger than 7 days (FR-9, US-004, US-015 display name).
-- Decision: docs/decisions/0003-staff-auth-sessions-and-writes.md

begin;

create table if not exists public.staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,  -- cascade: removing the auth account removes the membership
  display_name text not null check (char_length(display_name) between 1 and 50),  -- "Owner", "Office helper" (SCR-06 last updated by)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists staff_set_updated_at on public.staff;
create trigger staff_set_updated_at before update on public.staff
  for each row execute function app_private.set_updated_at();

-- True only for a staff member whose current session (JWT session_id) was created less than
-- 7 days ago. Supabase Free cannot time-box sessions, so the 7-day rule (FR-9) lives here and
-- every staff policy and RPC inherits it. Fails closed: no session_id, no staff row, or an old
-- session all give false.
create or replace function app_private.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    join auth.sessions ses on ses.user_id = s.user_id
    where s.user_id = auth.uid()
      and ses.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and ses.created_at > now() - interval '7 days'
      and (ses.not_after is null or ses.not_after > now())
  );
$$;
revoke all on function app_private.is_staff() from public;
grant execute on function app_private.is_staff() to authenticated, service_role;

-- GET /api/staff/me and the route-level session check: the caller's staff row, or no row.
create or replace function public.current_staff()
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.display_name
  from public.staff s
  where s.user_id = auth.uid()
    and app_private.is_staff();
$$;
revoke all on function public.current_staff() from public, anon;
grant execute on function public.current_staff() to authenticated, service_role;

-- RLS: every table, same migration
alter table public.staff enable row level security;
revoke all on table public.staff from anon;
revoke insert, update, delete, truncate, references, trigger on table public.staff from authenticated;

drop policy if exists staff_select_staff on public.staff;
create policy staff_select_staff on public.staff
  for select to authenticated
  using ((select app_private.is_staff()));
-- No insert, update or delete policy: Baseleap creates the two accounts with SQL (runbook);
-- there is no in-app user management (NG-4).

commit;

-- rollback
-- begin;
-- drop function if exists public.current_staff();
-- drop function if exists app_private.is_staff();
-- drop table if exists public.staff;   -- DESTRUCTIVE: removes the staff memberships (auth users stay)
-- commit;
