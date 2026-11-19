# QA Run Report

**Verdict: PASS / FAIL** — <n> failing · <n> flaky · <n> ACs not covered · <n> open fuzz findings
**Target:** <staging preview URL> @ <commit sha> · **Run:** smoke / full / targeted · **Step:** <id> · **Date:** <date> · **Duration:** <m:ss>

## Acceptance criteria

| AC | Risk | Test | mobile | desktop | embed | Result |
|---|---|---|---|---|---|---|
| AC-001.1 | H | auth.spec › AC-001.1 | ✅ | ✅ | — | pass |
| AC-003.2 | H | booking.spec › AC-003.2 | ❌ | ❌ | — | **fail** → BUG-<STEP>-1 |

Covered: <x>/<y> ACs · Not covered: <ids or none>

## Permission probes

| Operation | No auth | Cross-tenant | Role escalation | Mass assignment | Direct DB (RLS) |
|---|---|---|---|---|---|
| cancelBooking | ✅ 401 | ✅ 404 | ✅ 403 | ✅ ignored | ✅ denied |

Rate limits: <results> · Stored XSS: <results> · Secrets in bundle: <none found>

## Fuzz (Schemathesis)

| Role | Operations | Cases | Failures | Report |
|---|---|---|---|---|
| customer | <n> | <n> | <n> | `docs/qa-reports/fuzz/customer/` |

## NFR checks

| Check | Result |
|---|---|
| axe (all screens) | <0 violations> |
| GHL embed (400 px) | <pass> |
| Performance budgets | <LCP …> |
| Analytics events | <pass> |

## Flaky / quarantined

| Test | Status | Ticket |
|---|---|---|
| <none> | | |

## Tickets

| Ticket | Severity | Suggested owner | Title |
|---|---|---|---|
| BUG-<STEP>-1 | Important | bl-frontend | <…> |
