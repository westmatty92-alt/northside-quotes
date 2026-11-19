---
name: be-data
description: Data access for bl-backend — query Supabase Postgres through the typed client with the caller's session so RLS always applies, use the service-role key only where SECURITY_MODEL.md allows, avoid N+1 and unbounded queries, use transactions (RPC) for multi-step writes, and check query plans on the staging branch. Use whenever a service reads or writes data.
---

# Back-End · Data Access

The architect owns the schema; you own how it's queried. Two goals: every query respects row-level security, and nothing gets slow or inconsistent as the client's data grows.

## 1. Which client — RLS on by default

| Client | When | Rule |
|---|---|---|
| **User-scoped** Supabase client (from the request's session, `@supabase/ssr`) | almost everything | RLS applies — the database enforces tenant isolation even if your code has a bug |
| **Service-role** client (`src/lib/server/admin.ts`) | only the paths `docs/SECURITY_MODEL.md` names (webhooks, background jobs, admin tasks) | bypasses RLS — so every query must filter by tenant explicitly, and the file starts with `import 'server-only'` |

Never use the service-role client "because the query was easier". If RLS blocks something the PRD needs, that's a contract question for the architect (a policy is missing), not a reason to bypass it.

## 2. Typed queries

- Types come from `src/types/database.ts` (generated). Select explicit columns — never `select('*')` into an API response.
- Map database rows to API shapes in one function per resource (`toApi`), so internal columns never leak.
- Parameterised always: the Supabase client parameterises; never build SQL strings from input. Raw SQL only inside a database function (RPC) the architect defined.

## 3. No N+1, no unbounded reads

- Fetch related data in the same query (embedded selects / joins) or in one batched query by id list — never a query per row in a loop.
- Every list query is paginated (cursor from the contract) and ordered by an indexed key; `limit` always set.
- Counting large tables: avoid exact counts on every request; the contract only promises `next_cursor`.

## 4. Writes that must be all-or-nothing

Multi-step writes (create booking + mark slot taken + record payment intent) must not half-succeed. Use a **Postgres function (RPC)** with a transaction — owned by the architect as a migration; you call it. If one doesn't exist for a write that needs it, raise a contract question rather than chaining separate calls and hoping.

- Rely on database constraints for invariants (unique slot booking) and translate the violation (`23505`) into the contract's 409 — don't check-then-insert in application code (race condition).
- Optimistic concurrency where the contract has it (`updated_at` / version match → 409 on mismatch).

## 5. Check the plan, on the staging branch

For each new list or search query, run `EXPLAIN (ANALYZE, BUFFERS)` against the **staging Supabase branch** (via the read-only, project-scoped Supabase MCP or `psql` with the branch's read connection) with seed data at the PRD's expected volume. Note in your report the index each key query uses. A sequential scan on a growing table is a finding for the architect.

## 6. Renaming or dropping a column (expand/contract)

Follow `ops-release` §3: release 1 adds the new column, backfills and keeps both in sync, and the app moves to the new one; release 2 drops the old one.
- **Before the drop, search the database, not just the app.** Functions, triggers, views and RLS policy expressions that name the column (`grep -rn '<column>' supabase/`) must move to the new column **in the same migration, before the drop**. Postgres resolves columns inside plpgsql functions only when they run, so the drop applies cleanly and every write breaks afterwards. (Drill, Nov 2026: `jobs_guard` and `jobs_record_change` still compared `notes`.)
- Also update tests outside the app (pgTAP under `supabase/tests/`), and regenerate the database types once the migration has run locally.
- The API field can keep its name; only the column changes.
- A drop is a forward migration with a written rollback note (re-add, backfill from the new column), never a down-migration on production.

## 7. Seeds

`supabase/seed.sql` (your lane owns it): realistic, non-personal data at the PRD's volumes for tests and previews. Never real client data, never production.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills `sql-database-assistant` (MIT — N+1 detection, parameterised queries, short transactions), Jeffallan/claude-skills `postgres-pro` (MIT — EXPLAIN ANALYZE/BUFFERS, index tuning), OneWave-AI `database-schema-designer` (MIT — constraints over app checks). Supabase MCP docs (read-only + project-scoped mode; never connect to production).
