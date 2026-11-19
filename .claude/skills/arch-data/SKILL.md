---
name: arch-data
description: Data modelling for bl-architect — derive the Postgres schema from the PRD's stories and real queries, encode the rules as constraints, give every table RLS, and write reversible Supabase SQL migrations plus RLS tests. Use after the stack decision, before the API contract.
---

# Architect · Data & Migrations

The database enforces the rules the app must never break. If a rule only lives in application code, some agent will eventually write code that skips it.

## 1. Requirements first, tables second

From `docs/PRD.md`, `docs/user-stories.md` and `docs/user-flows.md` (the designer's screen inventory and data needs) extract:
- **Entities** and how they relate, in plain language (1:1, 1:N, N:M).
- **The 5–10 most important queries** — what each key screen lists, filters and sorts (the Data needs column of `docs/user-flows.md`).
- **Volumes** — rows per table per year, read/write mix (PRD technical considerations).
- **Tenancy & roles** — who owns which rows; which roles see what (PRD roles & permissions).
- **Money, time, personal data, deletion and audit needs.**

## 2. Model and constrain

- Normalise to 3NF; denormalise only for a named query, and say which.
- Keys: `uuid` primary keys (`gen_random_uuid()`) — matches Supabase auth ids and is safe to expose.
- Types: `timestamptz` always; money as integer **cents** (`bigint`) plus a currency column if multi-currency — never float; `text` (no `varchar(255)` by habit); `check` constraints or lookup tables instead of Postgres `enum` for values that will change.
- Every rule the PRD states becomes a constraint where possible: `not null`, `unique` (case-insensitive for emails via `citext` or `lower()` index), `check`, foreign keys with a **deliberate** `on delete` (cascade / set null / restrict — say why).
- `created_at` / `updated_at` with a trigger that actually updates `updated_at`.
- Soft delete only where the PRD needs restore or audit — paired with partial unique indexes.
- Operator/tenant column (`operator_id` or `org_id`) on every tenant-owned table, leading in composite indexes and unique constraints.

## 3. Indexes come from queries

For each query in §1, name the index that serves it (in a comment above the index). Index every foreign key you join or cascade on. No speculative indexes — every index slows every write.

## 4. Row-level security — every table, no exceptions

- `alter table … enable row level security;` on **every** table in `public`, in the same migration that creates it.
- At least one policy per operation the app performs; default deny for everything else.
- Baseleap convention: `auth.uid() = operator_id` for operator-owned rows; membership checks through a `members` table for multi-user tenants. Write the policy for each role in the PRD's permission matrix.
- The service-role key bypasses RLS — server-only code paths that use it must be named in `docs/SECURITY_MODEL.md`.
- **Tests:** for every table, `supabase/tests/rls/<table>.sql` asserts that a user sees their rows, can't see another tenant's, and can't write what their role forbids. RLS checks run on the executable SQL, never on comments.

## 4b. RLS tests (pgTAP) — the session setup

To act as a user in a test, set **both** claim settings:
`select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', '<uuid>', true);` then `set local role authenticated;`.
`auth.uid()` reads `claim.sub` on older Supabase images and `claims->>'sub'` on newer ones. With only one set, some environments see a NULL user: in dry run A2, 26 of 64 assertions failed that way. For the anonymous case, set both to `''`.

## 5. Migrations

- Files: `supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql` (template: `templates/migration.sql`), one concern per file, applied in order.
- Idempotent where practical (`if not exists`), wrapped in a transaction.
- Every migration has a **written rollback** (in a `-- rollback` block at the end). Destructive rollbacks (dropping data) are called out in your report.
- For existing production tables: no long locks — add columns nullable, backfill in batches, then add constraints; create indexes `concurrently` (outside the transaction).
- Seed data for development only, in `supabase/seed.sql` — never real client data.

## 6. Verify

The blueprint step's verify runs `scripts/check-architecture.mjs` on your migrations. It checks RLS and policies per table in the same file, timestamptz, no float money, `on delete` on every reference, and a rollback block. The migrations and RLS tests then run for real in the scaffold step (`npm run db:test` on the Supabase preview branch). Before reporting, also write the key queries from §1 into your report with the index each one uses.

## 7. ERD

Add a Mermaid `erDiagram` to `docs/architecture.md` — tables, keys, relationships. Matthew reads it at Gate 2.

---
Sources (ideas adapted, text written for Baseleap): OneWave-AI/claude-skills `database-schema-designer` (MIT — queries before tables, constraints as rules, index-from-queries, timestamptz/no-float-money, tenant column + RLS, real rollbacks, failure modes), mohitagw15856/pm-claude-skills `database-schema-design` (MIT — access-pattern analysis, ERD, soft-delete conventions). borghei `database-schema-designer` reviewed for ideas only (Commons Clause).
