-- <YYYYMMDDHHMMSS>_<slug>.sql
-- Purpose: <one line — what this migration adds and which FR/story it serves (FR-n, US-NNN)>
-- Decision: docs/decisions/<NNNN-slug>.md (if any)

begin;

create table if not exists public.<things> (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references auth.users(id) on delete cascade,  -- tenant owner; cascade: <why>
  name         text not null check (char_length(name) between 1 and 200),
  amount_cents bigint not null check (amount_cents >= 0),                  -- money as integer cents
  status       text not null default 'open' check (status in ('open', 'done')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Query: "<screen> lists a user's open things, newest first" (US-NNN)
create index if not exists <things>_operator_status_created_idx
  on public.<things> (operator_id, status, created_at desc);

-- updated_at that actually updates
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists <things>_set_updated_at on public.<things>;
create trigger <things>_set_updated_at before update on public.<things>
  for each row execute function public.set_updated_at();

-- RLS: every table, same migration
alter table public.<things> enable row level security;

drop policy if exists <things>_select_own on public.<things>;
create policy <things>_select_own on public.<things>
  for select using (auth.uid() = operator_id);

drop policy if exists <things>_insert_own on public.<things>;
create policy <things>_insert_own on public.<things>
  for insert with check (auth.uid() = operator_id);

drop policy if exists <things>_update_own on public.<things>;
create policy <things>_update_own on public.<things>
  for update using (auth.uid() = operator_id) with check (auth.uid() = operator_id);
-- No delete policy: deletes are not allowed for this table (PRD NG-n / FR-n).

commit;

-- rollback
-- begin;
-- drop table if exists public.<things>;   -- DESTRUCTIVE: drops all <things> data
-- commit;
