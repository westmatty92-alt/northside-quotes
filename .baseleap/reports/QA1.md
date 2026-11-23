# STEP QA1 — Test plan and Playwright E2E on the staging preview
## Attempt 1 — 2026-11-23
**Status:** partial. The plan and the full suite are written; the run is blocked by one Critical environment fault on the preview (BUG-QA1-1), so the done spine is **not proven** and 117 of 124 tests did not run.

**Preview under test:** https://northside-quotes-git-staging-baseleap.vercel.app. This is the host the brief expected (the config enforces a `*-git-staging-*.vercel.app` host, and refuses `http`, localhost and any production host). `/api/health` answered `ok` and its `version` contains `6ae29eb`, so it is serving `staging` at the commit named in the brief.

**Read:** `docs/PRD.md`, `docs/user-stories.md` (all 153 ACs), `docs/openapi.yaml` (paths, operations, `QuoteRequestCreate`), `docs/architecture.md` (routes, "Build requirements from S0" and "from PRD v1.2", lane ownership, retry and observability), `docs/SECURITY_MODEL.md` (permission matrix, sign-in limits, formToken scheme, invariants 12 to 22), `docs/design-specs.md` (screens, copy, accessibility, responsive), `docs/user-flows.md`, `docs/metrics-spec.md` (QA checklist), `.baseleap/reports/OPS1.md`, the QA skill templates. I did not read `src/` and did not open `.env.local` (values are loaded by the config and never printed).

## Results

| | |
|---|---|
| Command | `npx playwright test tests/e2e --grep-invert @probe` (see "Could not do": the `node --env-file=.env.local …` form was refused) |
| Tests in the suite | 124: setup 3, preview 4, phone 4, phone-late 2; the remaining 111 are the form, staff and board specs in `phone-staff` and `desktop` (the staff specs run once on a phone and once at 1280 px) |
| **Passed** | **3** (setup "fresh list of created data", `platform › health`, `platform › /inbox returns 404`) |
| **Failed** | **4** (setup sign-in owner, setup sign-in helper, `platform › SEC-2 two GETs of /`, `platform › the form-token routes are available`), each failing identically on the retry |
| **Did not run** | **117** (every project except `preview` depends on `setup`, which failed) |
| Flaky | 0 |
| Skipped, `fixme` or weakened | 0 |
| Duration | 30 s |

## Tickets

| Ticket | Severity | Owner | Class | Failing specs · trace · request id |
|---|---|---|---|---|
| BUG-QA1-1 | Critical | bl-devops (Matthew sets Vercel Preview values) | `env` | `auth.setup.ts › sign in as owner`, `… helper`; `platform.both.spec.ts › SEC-2 …` and `› the form-token routes are available …` · `test-results/auth.setup.ts-sign-in-as-owner-and-save-the-session-setup/trace.zip` · `GET /` → `yul1::yul1::fk5tx-1795472820349-4e071fe2e455` (500); `POST /api/quote-requests` → `yul1::yul1::h2sml-1795473972424-d4c7f926c3da` (503); `POST /api/auth/sign-in` → `yul1::yul1::dhb22-1795473947215-e562143f8e3f` (503) |

Full ticket: `.baseleap/reports/QA1-errors.md`. Cause (unverified, QA cannot read Vercel variables): the symptoms match `docs/SECURITY_MODEL.md` invariant 15 for a missing or short `APP_SIGNING_SECRET` in the Preview environment. `GET /` is 500, a made-up form token gets 503 instead of 401, and sign-in is fail-closed 503.

## Done spine and the "also cover" list

Spine steps 1 and 3 **fail** (page 500, sign-in 503); steps 2, 4, 5, 6 not run. `/inbox` 404: **pass**. Nonce and `no-store`: **fail** (no page, so no token). All other items (tabs, Back and resend, 409 stale version, "Not copied: no offers consent", sign-out, drag with mouse and touch, Escape mid-drag, Move to keyboard, photo dialog) are written and **not run**. Per-criterion results are in `docs/qa-reports/latest-run.md`.

## Flaky tests

None. (A fail-then-pass would be reported FLAKY; the two failing platform checks failed on both attempts.)

## Unverified

- Everything behind sign-in and the Request page: no spec has met the running app beyond the sign-in page, whose accessibility tree matches the design (heading "Staff sign-in", Email, Password, Show, Sign in, no sign-up or reset). The specs use the exact copy from `docs/design-specs.md` and roles and labels only; expect `test`-class locator fixes on the first working run (QA's to fix and to report as such).
- Live GoHighLevel: `GHL_LOCATION_ID` and the token are unset, so every GHL AC (US-009, US-010, US-014 except AC-014.4, US-017) is covered only by the offline INT1/INT2 simulator tests and is **unverified live**.
- Which environment variable is missing (BUG-QA1-1).
- Database and bucket region (AC-001.13, AC-002.9), the audit record of status changes and the `events` table (AC-007.7, FR-21): nothing outside the database exposes them (SQ-1, SQ-3).
- Sign-out in this app revokes every session of that user (Supabase default scope): assumed by the suite and handled (the sign-out and session-ended tests sign in again afterwards). Not yet observed.
- Whether a finger drag is offered on the board (design-specs open question 8). `board › AC-016.2 … touch pointer` will say.

## Could not do

- **The ledger's `node --env-file=.env.local node_modules/.bin/playwright test tests/e2e --grep-invert @probe` was refused by the permission system ("requires approval").** Ran `npx playwright test tests/e2e --grep-invert @probe` instead, as the brief allows. `playwright.config.ts` loads `.env.local` itself with `process.loadEnvFile` (it does not override variables already set), so the two forms run the same suite. The ledger's own run with `--env-file` should behave identically.
- The Playwright MCP could not be used to explore the live app (`browser_run_code_unsafe` not permitted), and it could not have passed Vercel protection without printing a secret. The one structure I did capture is the sign-in page, through a spec.
- The 4G profile in AC-001.10 and AC-002.7 is my assumption (WebPageTest "4G", SQ-2).
- Verify lines: `test -s docs/test-plan.md` → exit 0. `grep -q 'vercel.app' docs/qa-reports/latest-run.md` → exit 0. Playwright run → exit 1, **only** because of BUG-QA1-1 (the four failures and the 117 blocked tests all trace to it); no test failed on a product behaviour I could ticket separately, because none could reach the product.
- `npx tsc --noEmit` → exit 0. `npx eslint tests/e2e playwright.config.ts` → exit 0, no output.

**CONTRACT QUESTION:** none. (The PRD writes the urgency labels "Emergency: active leak…" and the design "Emergency: Active leak…"; the suite matches `^Emergency` case-insensitively so it does not depend on the casing. PM or designer may want to make them agree.)
**BLOCKED:** BUG-QA1-1 needs a valid `APP_SIGNING_SECRET` (and, if that is not the cause, whichever variable the check turns up) in the Vercel Preview environment for `staging`, then a redeploy. By name only: `APP_SIGNING_SECRET`; confirm with `node scripts/env-check.mjs --vercel` (devops holds the Vercel token, QA does not).

## Spec questions raised (full text in `docs/test-plan.md`)
SQ-1 region evidence (devops/architect) · SQ-2 define "simulated 4G" (PM) · SQ-3 read access for the status-change history and `events` (architect) · SQ-4 AC-012.3 two-hour proof (PM) · SQ-5 empty-state criteria on a shared project (PM/architect) · SQ-6 a 51-request seed (bl-backend) · SQ-7 the 5-per-10-minutes limit makes the suite wait (accepted).

## Test data on staging
None created: nothing was submitted. Future runs tag requests `QA-E2E <run id>` and list them in `docs/qa-reports/qa-e2e-created.ndjson` and the run report; they cannot be deleted through the API (NG-7), so Baseleap removes them by hand.

## Files I wrote (all inside the owned paths, plus the two report files the brief names)
- `playwright.config.ts` — staging-only guard, `.env.local` loader, projects (setup, preview, phone, phone-staff, desktop, phone-late), reporters, traces, retries 1 for detection only
- `docs/test-plan.md` — all 153 ACs mapped, boundaries, permission rows (QA2), NFR checks, not-tested list, spec questions
- `docs/qa-reports/latest-run.md` — the run report (names the preview URL)
- `docs/qa-reports/playwright-results.json` — the run's JSON report (generated by the run)
- `docs/qa-reports/qa-e2e-created.ndjson` — the list of test data a run creates (empty this run; generated)
- `.baseleap/reports/QA1.md` (this file) and `.baseleap/reports/QA1-errors.md` — the tickets
- `tests/e2e/auth.setup.ts` — signs in owner and helper, saves sessions
- `tests/e2e/platform.both.spec.ts` — health and commit, nonce and `no-store`, form-token routes, `/inbox` 404
- `tests/e2e/auth.desktop.spec.ts` — sign-in, return to the tab opened, sign-out, wrong credentials, no sign-up or reset
- `tests/e2e/form.phone.spec.ts` — form validation, offers box, photo rules, 4G load, failed send
- `tests/e2e/spine.phone.spec.ts` — the done spine
- `tests/e2e/submissions.phone.spec.ts` — ticked, XSS name, no photos; Back and resend; double tap with three 5 MB photos
- `tests/e2e/late.phone.spec.ts` — upload drop mid-way; direct calls with no or odd offers value
- `tests/e2e/requests.both.spec.ts` — tabs, list, filter, search, helper rights, status from the list, weekly count
- `tests/e2e/detail.both.spec.ts` — price and note, 409, failures, no-consent state, photo viewer, expired session
- `tests/e2e/pipeline.desktop.spec.ts` — the board: columns, mouse and touch drag, Escape, keyboard, 409, failures
- `tests/e2e/pipeline.phone.spec.ts` — 375 px: taps only, no sideways scroll
- `tests/e2e/screens.both.spec.ts` — every screen's structure and axe
- `tests/e2e/support/{env,fixtures,api,budget,files,paths,pool,ui}.ts` — guard, bypass, axe, API client, submission budget, test images, URL predicates, data pool, page helpers
- Run artifacts, git-ignored and not to be committed (they hold session tokens and the bypass header): `playwright/.cache/` (saved sessions, slot ledger), `test-results/` (traces, screenshots, video), `playwright-report/`.

**Notes for the next step:**
- Reopen QA1 once BUG-QA1-1 is fixed and `staging` redeployed. Start with `npx playwright test tests/e2e/platform tests/e2e/auth.setup.ts` (about 30 s), then the full run.
- A full run takes about 25 to 30 minutes (the form accepts 5 requests per 10 minutes per address and the suite paces itself; the project order overlaps the wait).
- Never run the suite from two machines at once: they share the staging address's submission limit and the two staff accounts.
- A failed sign-in counts toward the lockout (5 per email in 15 minutes). The suite makes at most one wrong password for the owner per run. Do not run QA2's lockout probes on the owner or helper account before QA1's full run; use the unknown-email path, or wait out the pause.
- `.gitignore` already lists `/test-results/`, `/playwright-report/` and `/playwright/.cache/`.

## Attempt 2 — 2026-11-23
**Status:** blocked. The preflight failed, so per the brief the targeted re-check and the full suite were **not run**. BUG-QA1-1 is **still open**.

**Preview under test:** https://northside-quotes-git-staging-baseleap.vercel.app

**Confirm the fix (step 1)**
- `/api/health` → **200**, `{"status":"ok","version":"6ae29ebc6bd64342d86ee25048382eaf9f66c1a3"}`. Same commit as attempt 1 (`6ae29eb`).
- `GET /` → **500**, not 200. Request id `yul1::yul1::bksgf-1795476107311-f0e78f28b92e`. The error page's `data-dpl-id` is `dpl_53M55QX5BKRQXEpqEg4ES8FkMQ4j` (compare with the deployment Matthew redeployed: if it is an older one, the staging alias was not moved).
- Also still failing: `POST /api/quote-requests` with a made-up form token → **503** (expected 401 `form_token_invalid`), request id `yul1::yul1::bksgf-1795476109463-537c652a7160`. Same symptoms as attempt 1, so the new variables are not in effect on the deployment serving this URL, or a different variable is the problem. Unverified which.
- Command: `npx playwright test tests/e2e/platform.both.spec.ts --project=preview --retries=0` → exit 1, 2 passed (health, `/inbox` 404), 2 failed (SEC-2 nonces, form-token routes), 5 s.

**Counts:** pass 2 · fail 2 · flaky 0 (retries off for this preflight) · not run: the rest of the 124 (setup 3, phone, phone-staff, desktop and phone-late projects, plus nothing from the targeted `platform + auth.setup` re-check).
**Done spine passed:** no, not run (step 1 cannot start while `GET /` is 500). Not proven.
**Tickets:** BUG-QA1-1, Critical, bl-devops, **still open** (evidence in `.baseleap/reports/QA1-errors.md`, "Attempt 2 status"). No new product ticket: nothing past the first screen was reachable.
**Still unverified:** everything listed under Attempt 1 "Unverified" (the whole of sign-in and staff screens, the form, the board, photos, the 4G and 20 s budgets, live GHL), plus whether `/sign-in` and `POST /api/auth/sign-in` work now (not re-tested, to follow the stop instruction).
**Test data:** none created (no request submitted); `docs/qa-reports/qa-e2e-created.ndjson` stays empty.

**Files changed**
- `docs/qa-reports/latest-run.md` — attempt 2 verdict, preflight table with request ids, staging URL
- `docs/qa-reports/playwright-results.json` — generated by the preflight run (replaces attempt 1's file)
- `.baseleap/reports/QA1-errors.md` — "Attempt 2 status" block on BUG-QA1-1: still open
- `.baseleap/reports/QA1.md` — this section
- `tests/e2e/support/preflight.mjs` — new: prints status codes, the health version and request ids for `/api/health`, `/`, `/sign-in` (no secrets; staging-host guard). `node tests/e2e/support/preflight.mjs` was refused ("requires approval") in this session, so it is untried; `npx eslint tests/e2e playwright.config.ts` → exit 0. Not used for evidence. The ledger may run it, or ignore it.

**Could not do:** run `node tests/e2e/support/preflight.mjs` (permission refused); the targeted re-check and full suite (stop condition in the brief).
**CONTRACT QUESTION:** none.
**BLOCKED:** `APP_SIGNING_SECRET` (and possibly another name) not in effect for the deployment behind the staging URL. Devops: `node scripts/env-check.mjs --vercel`, confirm the Preview value is set for `staging` and at least 32 characters, then confirm the staging alias points at a deployment built after it. Then reopen QA1.
