---
name: qa-regression
description: Suite health for bl-qa — isolated test data per run, deterministic and resilient tests, smoke vs full regression runs, a regression test for every bug before its fix is accepted, and a strict flake policy (a pass on retry is a flaky result, never a pass; never weaken, skip or delete a test to get green). Use whenever writing, maintaining or re-running the suite.
---

# QA · Regression Suite & Flake Control

A suite people don't trust is worse than none: it trains everyone to ignore red. Keep it deterministic, fast where it gates, and honest.

## 1. Isolation

- **One tenant per run.** The setup project creates a fresh tenant (`qa-<run id>`) with its users and records on the staging branch, and the teardown deletes it. Tests never share mutable records across files; each test creates what it changes.
- Read-only reference data (plans, services) comes from `supabase/seed.sql`.
- Never reset the staging branch from a test, never touch other tenants, never depend on test order.
- Time-dependent rules: control time (Playwright `page.clock`) instead of waiting for real time.

## 2. Deterministic and resilient

- Role/label locators and web-first assertions only (see `qa-e2e` §3).
- Wait on the outcome (a response, an element), never on a timer.
- Third-party side effects (email, Stripe) are asserted through test mode or the app's recorded state, not by polling a real inbox.

## 3. Smoke vs full

| Run | Selection | When | Time budget |
|---|---|---|---|
| Smoke | `--grep @smoke` | every staging deploy; before Gate 3 | ≤ 3 min |
| Full | everything + fuzz + probes | Phase 3, every reopen after a fix, before Gate 3 | ≤ 20 min |
| Targeted | the failing spec + its file's neighbours | inside the fix loop | ≤ 2 min |

## 4. Red before green

Every bug QA finds gets a **failing test first** — committed to the suite, named after the AC and the bug (`AC-003.2 regression: double-click books twice`). The fix is accepted only when that test passes on the redeployed preview, along with the rest of the suite. The test stays forever.

## 5. Flake policy

- CI allows one retry **for detection only**: a test that fails then passes is reported as **FLAKY**, not as passed.
- A flaky test is a bug in either the test (`test`, yours to stabilise) or the app (race condition — `impl`, routed). Find out which; don't guess.
- **Never** weaken an assertion, add a sleep, `skip`, `fixme`, raise a timeout to hide slowness, or delete a test to get green. Quarantining a test (`test.fixme`) needs the orchestrator's acknowledgement and a ticket, and is listed in every report until it's fixed.
- You may change a test only when the test itself is wrong (it contradicts the PRD or contract). Say so in the report with the AC it now matches.

## 6. Coverage you report

Against the test plan, not lines of code: ACs with a passing test / total ACs, permission rows passed, NFR checks passed, fuzz findings open. Any AC without a test is listed by id.

---
Sources (ideas adapted, text written for Baseleap): laurigates/claude-plugins `vitest-testing` (MIT — setup/teardown, isolation, mocking), obra/superpowers `test-driven-development` + `systematic-debugging` (MIT — red-green, root cause before fixes, no "retry until green"), lackeyjb/playwright-skill (MIT — resilient selectors).

## Offline provider drills (for bl-integration)
QA re-runs the integration engineer's outage and webhook drills against its simulators (`tests/mocks/<provider>/`) with **no network** (a container started with `--network none`, or the project's offline test command; if `node_modules` is mounted read-only, add `--tmpfs /work/node_modules/.vite-temp` so Vitest can write its temp config), and reports per provider: suites run, passed, and anything that tried to reach the network. A test that needs the network to pass is a finding routed to bl-integration.
