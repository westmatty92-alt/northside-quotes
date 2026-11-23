# QA Run Report

**Verdict: FAIL (attempt 2 stopped at the preflight).** `GET /` on the staging preview is still 500 and the form-token route is still 503, so, as the brief said, the targeted re-check and the full suite were not run. Nothing was submitted and no staff member signed in.
**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Run:** preflight only (`npx playwright test tests/e2e/platform.both.spec.ts --project=preview --retries=0`) · **Step:** QA1, attempt 2 · **Date:** 2026-11-23 · **Duration:** 5 s
**Health:** `/api/health` answered 200 `{"status":"ok","version":"6ae29ebc6bd64342d86ee25048382eaf9f66c1a3"}`. This is the same commit as attempt 1, so the redeploy was of the same commit with new variables. The deployment id in the 500 page's HTML is `dpl_53M55QX5BKRQXEpqEg4ES8FkMQ4j` (not a secret; check it against the deployment Matthew redeployed).
Raw results: `docs/qa-reports/playwright-results.json` (this preflight run; it replaced attempt 1's file). Traces and screenshots are in `test-results/` (git-ignored; they hold the bypass header).

## Preflight result

| Check | Expected | Observed | Request id |
|---|---|---|---|
| `GET /api/health` | 200 | **200**, commit `6ae29eb` | not recorded by the test |
| `GET /` (Request a quote page) | 200 with a form token | **500** (Next.js error page, `id="__next_error__"`) | `yul1::yul1::bksgf-1795476107311-f0e78f28b92e` |
| `POST /api/quote-requests` with a made-up form token | 401 `form_token_invalid` | **503** `service_unavailable` | `yul1::yul1::bksgf-1795476109463-537c652a7160` |
| `GET /inbox` and `/inbox?view=board` | 404 | **404** (pass) | |

Two passed (health, `/inbox` 404), two failed (SEC-2 nonces and `no-store`: no page to read; form-token routes available). Each failure is the same as attempt 1. Flaky: 0 (retries were off for the preflight on purpose; attempt 1's retry gave the same result).

## What this means

The signing-secret fix did not take effect on this deployment, or the missing or invalid variable is a different one. Identical symptoms to attempt 1 (500 on `/`, 503 on the token route). QA cannot read Vercel variables, so which one is unverified. Things for devops to check, by name only: `APP_SIGNING_SECRET` is set for the **Preview** environment (and scoped to the `staging` branch if the project scopes variables by branch), is at least 32 characters, and the deployment serving the staging alias was built **after** it was set (Vercel applies a changed variable only to new deployments; "Redeploy" with the build cache can be fine, but the alias must point at the new deployment); `node scripts/env-check.mjs --vercel` lists missing names. The Supabase variables and `SITE_URL` are also needed for `GET /`; the made-up-token 503 is checked before the database, which points at the signing secret, as in attempt 1.

## Done spine (must pass)

NOT RUN. Not proven. Same as attempt 1: step 1 cannot start because the page does not load.

## Acceptance criteria

Passed: 0 · Failed with direct evidence: AC-001.1 (page does not load), AC-004.1 (sign-in 503 in attempt 1; not re-observed this attempt) · Not run: 91 (BUG-QA1-1). Per-AC mapping is in `docs/test-plan.md`. 93 ACs have a written spec; 60 are QA2 probes, offline integration tests, database rules or not testable on a shared staging project, per the plan.

## Permission probes, fuzz, NFRs

Not run (not part of QA1, or blocked). No permission boundary was observed crossed.

## Flaky / quarantined

None. No test is skipped, `fixme`'d or weakened.

## Test data left on staging

None. Nothing was submitted, so `docs/qa-reports/qa-e2e-created.ndjson` is empty (the file lists nothing for run attempt 2).

## Tickets

| Ticket | Severity | Suggested owner | Status |
|---|---|---|---|
| BUG-QA1-1 | Critical | bl-devops (Matthew sets the Vercel value) | **STILL OPEN** after the redeploy: `GET /` 500, form-token route 503 (ids above) |

## Notes for the next run

- Reopen QA1 after `GET /` returns 200 on the staging preview. Then: `npx playwright test tests/e2e/platform tests/e2e/auth.setup.ts`, then the full run (about 25 to 30 minutes).
- `node tests/e2e/support/preflight.mjs` (written this attempt) prints the status of `/api/health`, `/` and `/sign-in` with request ids and no secret; the session's permission system refused it ("requires approval"), so the preflight above ran through Playwright instead.
