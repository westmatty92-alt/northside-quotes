# <Code | Security> Review · <STEP>

**Verdict: APPROVED / BLOCKED** — <n> Critical · <n> Important · <n> Minor open
**Reviewer:** bl-<reviewer|security> · **Diff:** `<base>..<head>` (<n> files, +<a> −<d>) · **Round:** 1 / re-review of <ids> · **Date:** <date>

## Findings (Critical first)

### SEC-1 · Critical · Confirmed — Booking cancel ignores tenant
| | |
|---|---|
| **Where** | `src/lib/server/services/bookings.ts:88` |
| **Breaks** | SECURITY_MODEL invariant 2 (tenant isolation) · AC-004.1 |
| **What's wrong** | `cancel()` uses the service-role client and filters by `id` only. |
| **Scenario** | A signed-in user of tenant B cancels tenant A's booking by sending its id. |
| **Fix direction** | Use the user-scoped client (RLS) in `cancel()`, or add `.eq('operator_id', session.operatorId)`; add a cross-tenant 404 test in `tests/api/bookings.test.ts`. |
| **Owner hint** | backend |
| **Signature** | `authz: bookings.cancel uses service role without tenant filter` |

## Acceptance criteria (code review) / Checks (security review)

| Item | Result | Evidence |
|---|---|---|
| AC-004.1 cancel own booking | not met | SEC-1 |
| Secret scan (diff + history + build output) | passed | `.baseleap/reviews/<STEP>/gitleaks*.json` — 0 |
| Dependency CVEs (prod) | not assessable | osv-scanner unavailable on runner — see limits |

## Tool results

| Tool | Ran on | Raw | Findings | Dismissed (false positive, reason) |
|---|---|---|---|---|
| opengrep (`.opengrep/baseleap.yml`) | diff files | `.baseleap/reviews/<STEP>/opengrep.json` | 2 | 1 — `admin-import`: test helper, allowed by SECURITY_MODEL |

## Minor (non-blocking)

- REV-7 · `src/components/bookings/List.tsx:12` — duplicate date formatter; use `src/lib/shared/format.ts`.

## Coverage & limits

- Read in full: <files>. Grepped for context: <what>. Not reviewed: <what, why>.

## Cross-lane consolidation
| Duplicate | Where (each lane) | Move to / import from | Owner |
|---|---|---|---|

## Pre-existing (not this change; for the architect)
