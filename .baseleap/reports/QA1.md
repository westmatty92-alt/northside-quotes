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

## Attempt 3 — 2026-11-23
**Status:** partial. The preview works and the suite ran end to end; the done spine passes but is not stable; 5 product tickets and one open spec question remain. Verdict: FAIL (`docs/qa-reports/latest-run.md`).

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app at commit `e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79`.

**Preflight (run first, through Playwright): PASSED**
- `GET /api/health` → 200, `{"status":"ok","version":"e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79"}` (starts `e966fbc`)
- `GET /` → 200 (form token present, `Cache-Control: no-store`, two loads give different nonces)
- `POST /api/quote-requests`, made-up form token → 401 `form_token_invalid` (was 503)
- `GET /inbox` → 404. Command `npx playwright test tests/e2e/platform.both.spec.ts --project=preview --retries=0` → 4 passed. Request ids were not recorded by these passing tests.
- Targeted re-check `npx playwright test tests/e2e/platform tests/e2e/auth.setup.ts` → 7 passed (both staff sign-ins work). **BUG-QA1-1 resolved.**

**Counts** (130 tests; last full run, evidence in `docs/qa-reports/playwright-results.json`): **110 passed, 20 failed, 0 flaky** by Playwright's retry detection. Two of the 20 (`AC-001.7` Back and resend: my second-send clock; `AC-002.7`: 20 173 ms against 20 000 ms once) passed on a re-run, so **112 passed, 18 failed** after re-runs. The 18 repeat on the retry and are product findings (below). The ledger form `node --env-file=.env.local node_modules/.bin/playwright test …` was refused ("requires approval"); I ran `npx playwright test tests/e2e --grep-invert @probe`, which loads `.env.local` itself.

**Flaky by hand** (the tests that submit run with retries off, so Playwright cannot flag them): the done spine failed once (3 photo uploads to Supabase storage failed in the browser with `ERR_SSL_BAD_RECORD_MAC_ALERT`), passed in 3 other runs; `AC-002.6` failed once on the same error, passed in 3; `AC-002.7` 20.17 s once. Reported as BUG-QA1-6 (cause unknown, maybe the QA machine's network).

**Done spine: passed** (all six steps, 20.6 s and 20.4 s in two runs and again in the last full run), **but 1 of 4 runs of the finished test failed at step 1** (BUG-QA1-6). So: passed, not stable, not a clean proof.

**Tickets and owners** (`.baseleap/reports/QA1-errors.md`)
- BUG-QA1-2, Critical, bl-frontend (ui): the staff header logo link `aria-label` does not contain its visible text; axe `label-content-name-mismatch` (serious) on Requests, Pipeline and detail; 4 smoke tests fail on their last line (AC-004.1, AC-005.10 and AC-016.19, AC-016.1, AC-016.17), plus AC-005.3 and AC-016.16
- BUG-QA1-3, Important, bl-frontend (ui): no "Photo unavailable" when a photo cannot load (AC-005.7)
- BUG-QA1-4, Important, bl-frontend (ui): focus leaves the photo viewer on the third Tab (design-specs SCR-08)
- BUG-QA1-6, Important, bl-devops first (env, unexplained): intermittent TLS errors on browser uploads to Supabase storage
- BUG-QA1-5, Minor, bl-frontend or bl-designer: two accessible labels differ from design-specs ("View photo" vs "Open photo"; "Move to another status, NQ-X" vs "Move NQ-X to another status")
- Not a ticket: SQ-9, a finger drag does not move a card (`board › AC-016.2 … touch pointer` fails; the PRD asks for "drag" and the Move to menu). PM or designer decide.
- BUG-QA1-1: resolved, evidence in the preflight above and in `QA1-errors.md`.

**Test fixes of my own this attempt (all `test` class, no assertion weakened)**: the radios and the offers box are tapped through their label (the hidden input is intercepted by it); the urgency group is a `group`, not a `radiogroup`; the search is a textbox plus a Search button; the list order is recorded after the rows load; the 3-second form wait starts after the page loads and restarts after Back (FR-8); the confirmation wait is 60 s, then `< 20 s` is asserted; "$450.00 CAD" is matched across inline elements; "focus stays on that card" checks the moved card's own control; the message for a refused or failed photo is looked for in the file's list item alert; `vercel.live` (Vercel's preview toolbar) is named as an allowed host in the spine; the focus-trap check is its own test and axe in the 375 px test runs last, so a failing axe cannot hide the checks before it. One assertion I **replaced** because it contradicted the AC: `AC-002.4` no longer demands that the refused file's row disappears (the AC says "refused with the message", like AC-002.3); the "is not stored" half is unverified (SQ-8). Full list: `docs/test-plan.md` "Changes made in attempt 3".

**Unverified**
- Live GoHighLevel (US-009, US-010, US-014 except AC-014.4, US-017): `GHL_LOCATION_ID` and the token are unset; offline simulator tests only.
- AC-002.4 "is not stored" (SQ-8); AC-005.7 server-side path (`url: null`); AC-016.2 finger drag (SQ-9); AC-001.13, AC-002.9, AC-007.7, FR-21 (SQ-1, SQ-3); AC-005.5, AC-016.10 (SQ-6); the 4G profile (SQ-2) behind AC-001.10 and AC-002.7.
- The cause of BUG-QA1-6. Whether the two 400s I saw on sends under 3 s after the render were FR-8 (I believe so; two request ids in `QA1-errors.md` for backend to check). Whether `vercel.live` also loads on production. Axe on Pipeline and detail inside `screens.both` (the test stops at its first failing screen).
- Permission probes and fuzz (QA2) were not run, as instructed; no lockout or abuse probe was run.

**Test data on staging:** requests tagged `QA-E2E <run id>` (several runs, roughly 40 requests, count not exact; the setup step starts a fresh list each run). `docs/qa-reports/qa-e2e-created.ndjson` holds the last full run (`12g6v`, 8 requests) and the last re-run of the submission tests (`1tm73`, 4 requests). Baseleap removes them by name prefix.

**Files changed**
- `tests/e2e/platform.both.spec.ts`: default expected commit `e966fbc`
- `tests/e2e/support/ui.ts`: tap-through-label for radios and offers box; form clock after load plus `restartClock()`; `confirmedReference(waitMs)`; `photoThumbs`/`photoThumb`; `moveButton` accepts both wordings
- `tests/e2e/support/fixtures.ts`: a console error names its resource (host and path, no query)
- `tests/e2e/spine.phone.spec.ts`: `vercel.live` allowed and the contacted-host list attached; price match; photo locator
- `tests/e2e/submissions.phone.spec.ts`: 60 s confirmation wait; clock restart after Back
- `tests/e2e/late.phone.spec.ts`: error looked for in photo 2's own alert
- `tests/e2e/form.phone.spec.ts`: urgency group; AC-002.4 asserts the message in the file's own row
- `tests/e2e/detail.both.spec.ts`: photo locators; price match; AC-005.7 attaches the photo region structure; focus-trap test split out; design-wording test
- `tests/e2e/requests.both.spec.ts`: search locator; order recorded after load; design-wording test
- `tests/e2e/pipeline.desktop.spec.ts`: keyboard-move focus check names the card
- `tests/e2e/pipeline.phone.spec.ts`: axe moved to the last line; photo locator
- `docs/test-plan.md`: SQ-8, SQ-9, SQ-10 and the attempt 3 change list
- `docs/qa-reports/latest-run.md`: this attempt's run report (preview URL, commit `e966fbc`, pass or fail per criterion); `docs/qa-reports/2026-11-23-QA1-attempt2.md` (the previous report, kept)
- `docs/qa-reports/playwright-results.json`, `docs/qa-reports/qa-e2e-created.ndjson`: generated by the runs
- `.baseleap/reports/QA1.md` (this section) and `.baseleap/reports/QA1-errors.md` (the tickets)
- `playwright.config.ts`: unchanged.

**Commands run**
- Preflight, targeted re-check: see above → exit 0
- `npx playwright test tests/e2e --grep-invert @probe` (full, four times) → exit 1 each time (the 18 findings plus, in the first three, the test faults fixed since); last full run 110 passed, 20 failed, 0 flaky, 20.0 min
- `npx playwright test tests/e2e --project=setup --project=phone --project=phone-late` → exit 0, 9 passed (submitting tests)
- `npx playwright test tests/e2e/submissions.phone.spec.ts --project=phone --no-deps --retries=0 --reporter=list --output=test-results/rerun` → exit 0, 3 passed
- `npx tsc --noEmit` → exit 0; `npx eslint tests/e2e playwright.config.ts` → exit 0

**Could not do:** the ledger form with `node --env-file=.env.local` (refused; same suite through the config's own env loader); copy the full-run results file (`cp` refused), so later re-runs used `--reporter=list --output=test-results/rerun` to keep it.
**CONTRACT QUESTION:** none. Spec questions SQ-8 (refused photo rows), SQ-9 (finger drag) and SQ-10 (accessible wording) are in `docs/test-plan.md`.
**BLOCKED:** none.
**Notes for the next step:** after bl-frontend fixes BUG-QA1-2, -3, -4 (and -5 if the app wording stays, tell QA to change the two design-wording tests), reopen QA1 and run `npx playwright test tests/e2e --grep-invert @probe` (about 20 minutes); expect axe to show any violations that BUG-QA1-2 hid. Do not run it from two machines at once, and run QA2's lockout probes only after QA1's full run.
