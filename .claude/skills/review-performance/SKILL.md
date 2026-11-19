---
name: review-performance
description: Performance and concurrency review for bl-reviewer — find N+1 loops, unbounded or unindexed queries, missing pagination, race conditions in booking and payment paths, missing idempotency on state changes, blocking or slow work inside requests, connection and memory leaks, and front-end bundle or waterfall regressions. Use on every code-review step.
---

# Review · Performance & Concurrency

Most production incidents in client stacks come from code that works perfectly with ten rows and one user. Review as if there are a hundred thousand rows and two people clicking at the same moment.

## 1. Database access

| Look for | Why it bites | Typical fix direction |
|---|---|---|
| A query inside a loop (`for … await supabase.from(…)`) | N+1: one request becomes hundreds | embedded select / `in()` batch |
| A list query without `limit` or cursor | memory and latency grow with the data | the contract's cursor pagination |
| Filter or sort on a column with no index in the migrations | full scans as tables grow | an index migration (architect) |
| `select('*')` into a response | leaks columns, wastes bandwidth | explicit columns + `toApi` |
| Exact `count` on large tables per request | slow on every call | drop it, or cache/estimate |

Check against the architect's "key queries and their indexes" in `docs/architecture.md`; a key query with no listed index is a finding.

## 2. Concurrency on things that matter

- **Check-then-act** (read slot free → insert booking) without a database constraint or transaction → **Critical** on money/booking paths (double booking, double charge).
- Multi-step writes not in one transaction/RPC → partial state on failure.
- Missing **idempotency** on creates/charges/sends (no `Idempotency-Key` handling, webhook events not de-duplicated by id) → duplicate side effects on retry.
- Optimistic updates in the UI without rollback on a 409.

## 3. Work inside a request

- Slow third-party calls, bulk sends or large exports done inline (risk of hitting the function timeout) → should be background jobs per `arch-reliability`.
- Missing timeouts on outgoing calls; retries without backoff; retries of non-retryable errors.
- Awaiting independent calls one after another instead of `Promise.all`.

## 4. Leaks and resources

Creating a new Supabase/provider client per loop iteration, unbounded in-memory caches or arrays, listeners/intervals never cleared, large files read fully into memory.

## 5. Front end

- Request waterfalls (a child fetching only after its parent renders) where data could load together or on the server.
- Heavy libraries pulled into the client bundle for small use; client components where a server component would do.
- Bundle or Core Web Vitals regressions against the budgets in `fe-performance` (use the build output's route sizes).

## 6. Evidence

Point to the line, explain the scale at which it breaks (from the PRD's expected volumes), and where possible show it: the query plan from the staging branch, the route size from `npm run build`, or the two-request race that produces a duplicate.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills `sql-database-assistant` (MIT — N+1, pagination, unindexed filters, transactions/locks), Jeffallan/claude-skills `postgres-pro` (MIT — query plans). borghei/Claude-Skills senior reviewer reviewed for ideas only (Commons Clause — blocking I/O, missing idempotency keys on state mutations).
