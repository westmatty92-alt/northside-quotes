# QA Run Report

**Verdict: FAIL.** 18 of 130 tests fail on real product findings (5 tickets), the done spine passes but is not yet stable (see "Done spine"), and one criterion has a test that fails because the spec leaves the behaviour open (SQ-9). No permission boundary was probed (QA2).
**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Commit under test:** `e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79` (from `/api/health`) · **Step:** QA1, attempt 3 · **Date:** 2026-11-23 · **Run type:** preflight, targeted re-check, then full (`npx playwright test tests/e2e --grep-invert @probe`, about 20 minutes). The ledger form `node --env-file=.env.local node_modules/.bin/playwright test …` was refused by the permission system; `playwright.config.ts` loads `.env.local` itself, so the two forms run the same suite.
Raw results of the last full run: `docs/qa-reports/playwright-results.json`; failure traces, screenshots and videos: `test-results/` (git-ignored; they hold the bypass header, do not share). Later targeted re-runs used `--reporter=list --output=test-results/rerun` so they did not overwrite these.

## Preflight (before anything else): PASSED

| Check | Expected | Observed |
|---|---|---|
| `GET /api/health` | 200, version starts `e966fbc` | **200** `{"status":"ok","version":"e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79"}` |
| `GET /` | 200 | **200** (page with a form token, `Cache-Control: no-store`, two loads carry different nonces) |
| `POST /api/quote-requests`, made-up token | 401 | **401** `form_token_invalid` |
| `GET /inbox`, `/inbox?view=board` | 404 | **404** |

Run as `npx playwright test tests/e2e/platform.both.spec.ts --project=preview --retries=0`: 4 passed. Then `npx playwright test tests/e2e/platform tests/e2e/auth.setup.ts`: 7 passed (both staff sign-ins work). **BUG-QA1-1 is resolved** (cause: `CRON_SECRET` with trailing whitespace; fixed, redeployed).

## Counts

| Run | Tests | Passed | Failed | Flaky (Playwright retry) |
|---|---|---|---|---|
| Last full run (evidence on disk) | 130 | 110 | 20 | 0 |
| After re-runs of the 2 tests that failed for test-side or marginal reasons | 130 | 112 | 18 | 0 |

The 18 failures all repeated on the one retry (not flaky) and are the product findings below. The two that passed on re-run: `AC-001.7` Back and resend (my second-send clock; fixed, console 400 gone) and `AC-002.7` (confirmation took 20 173 ms against a 20 000 ms limit once; under 20 s in the other runs: marginal, see below). Tests that submit run with retries off (the submission limit), so Playwright cannot flag them FLAKY; I flag them by hand under "Flaky".

## Done spine: PASSED, but not stable

All six steps passed (homeowner sends with 3 photos and sees an NQ- reference; the owner signs in and sees it first; price and note survive a reload; Won from the list; Won again from the board; the weekly Won count moved within 2 s) in 3 of the 4 runs of the finished test (20.6 s, 20.4 s and the last full run). In 1 run it failed at step 1: all three direct photo uploads to Supabase storage failed in the browser with `net::ERR_SSL_BAD_RECORD_MAC_ALERT`, the request stayed unsent, no reference. Root cause not known (see BUG-QA1-6). Treat the spine as FLAKY until that is explained. The spine also found `vercel.live` (Vercel's own preview toolbar) among the hosts the page contacts; it is named and allowed in the test, every other third-party host still fails it.

## Acceptance criteria (this is attempt 3's per-criterion result; mapping in `docs/test-plan.md`)

**Pass** (every test that carries the criterion passed, in the last full run or its re-run):
AC-001.1 .2 .3 .4 .5 .6 .7 .8 .9 .10 .11 .12 .14 .15 .16 .17 .18 · AC-002.1 .2 .3 .5 .8 · AC-003.1 .2 (page side) .6 · AC-004.2 .3 .4 .6 .7 .9 .10 .14 · AC-005.1 .2 .6 .8 .9 · AC-006.1 .2 .3 .4 .5 .6 .7 · AC-007.1 .2 .3 .4 .5 .6 · AC-008.1 .2 .5 .8 · AC-010.6 · AC-011.1 .3 .4 · AC-012.1 .2 · AC-013.1 .2 .3 · AC-014.4 · AC-015.1 .2 · AC-016.2 (mouse) .3 .5 .6 .7 .8 .9 .12 .13 .14 .15 .18 .20 · AC-017.16 · FR-1, FR-2, FR-26.

**Pass, with a stated limit:**
- AC-002.4: the refusal message "Photos must be JPEG, PNG or WebP" shows in the file's own row; "is not stored" is **unverified** (SQ-8).
- AC-002.6 and AC-002.7: pass, but each failed once (TLS errors; 20.17 s). Under "Flaky".

**Fail:**

| Criterion | Failing test | What fails | Ticket |
|---|---|---|---|
| AC-004.1 | `auth.desktop › AC-004.1` | Sign-in works and lands on Requests; the axe check on that screen finds one serious violation | BUG-QA1-2 |
| AC-005.3 | `detail › AC-005.3 AC-016.5` (phone, desktop) | Every field, link and photo assertion passes; axe on the detail screen finds the same violation | BUG-QA1-2 |
| AC-005.10, AC-016.19 | `requests › AC-005.10 AC-016.19` (phone, desktop) | Tabs open from their own addresses and are marked current (passes); axe on `/pipeline` fails | BUG-QA1-2 |
| AC-016.1, AC-016.8 | `board › AC-016.1 AC-016.8` (desktop) | Columns, order, cards pass; axe on the board fails (FR-23: 0 serious violations) | BUG-QA1-2 |
| AC-016.16 | `screens › AC-016.16 AC-005.10` (phone, desktop) | Axe on Requests fails (the test stops there; Pipeline and detail are covered by the rows above) | BUG-QA1-2 |
| AC-016.17 | `pipeline.phone › AC-016.17` | Tap-to-move, Won count within 2 s, stored status and no sideways scroll all pass; the final axe check fails | BUG-QA1-2 |
| AC-005.7 | `detail › AC-005.7` (phone, desktop) | With the photo files unreachable, no slot says "Photo unavailable" (0 of 3) | BUG-QA1-3 |
| US-012 design (SCR-08) | `detail › design: focus is trapped inside the open photo viewer` (phone, desktop) | Tab 3 sends focus to the page body, out of the dialog | BUG-QA1-4 |
| Design wording | `detail › design wording` and `requests › design wording` (phone, desktop) | Photo and Move buttons are worded differently from `docs/design-specs.md` | BUG-QA1-5 (Minor) |
| AC-016.2 (finger drag) | `board › AC-016.2 … touch pointer` (desktop) | A finger drag does not move the card; the PRD asks for "drag" and the Move to menu; spec question SQ-9, **not a product ticket** | none |

**Not run in this suite, or unverified:** see the last section.

## Permission probes, fuzz, NFRs

Permission probes and fuzz: not run (QA2). No boundary was observed crossed. NFR evidence from this run: AC-001.10 form usable within 3 s on the assumed 4G profile (pass); AC-005.8 and AC-016.18 first 50 rows and cards within 2 s on broadband (pass); AC-002.7 15 MB on 4G within 20 s (marginal: under 20 s in 2 of 3 runs, 20.17 s in 1); axe: 0 serious or critical violations on the Request page, the sign-in page and the photo viewer; 1 on every staff screen (BUG-QA1-2).

## Flaky / quarantined

No test is skipped, `fixme`'d or weakened. Playwright reported 0 flaky. By hand (tests that submit run with retries off):
- `spine` failed once (TLS errors on 3 photo uploads), passed in 3 other runs.
- `late › AC-002.6` failed once on the same TLS errors on photo-1 and photo-3 (the app recovered and the resend completed; only my console-error guard tripped), passed in 3 other runs.
- `submissions › AC-002.7` 20 173 ms once, under 20 s in the others.
- `submissions › AC-001.14 …` and `AC-001.7 Back and resend` each got a 400 once from a send under 3 s after the form was rendered (FR-8 working as designed); the test clock was wrong, fixed, both pass since.

## Test data left on staging

Requests cannot be deleted through the API (NG-7). Every request this attempt created is named `QA-E2E <run id> …` (the runs used different ids), so one prefix search finds them all; Baseleap removes them by hand. `docs/qa-reports/qa-e2e-created.ndjson` lists the last full run (run id `12g6v`, 8 requests) and the last re-run of the submission tests (`1tm73`, 4 requests); the setup step starts a fresh list each run, so earlier runs' requests (several runs, roughly 40 requests in total, count not exact) are only findable by the name prefix. One request made by the failing spine in the third full run was left incomplete (created, photos not uploaded, never submitted); by design it should not appear in the staff list, which I did not check for this one.

## Tickets (full text in `.baseleap/reports/QA1-errors.md`)

| Ticket | Severity | Suggested owner | Class |
|---|---|---|---|
| BUG-QA1-1 | was Critical | bl-devops | env: **RESOLVED** (`CRON_SECRET` whitespace) |
| BUG-QA1-2 | Critical (4 smoke tests fail) | bl-frontend | ui: staff header logo link `aria-label` does not contain its visible text, axe `label-content-name-mismatch` (serious) on Requests, Pipeline and detail |
| BUG-QA1-3 | Important | bl-frontend | ui: no "Photo unavailable" fallback when a photo cannot load (AC-005.7) |
| BUG-QA1-4 | Important | bl-frontend | ui: focus leaves the photo viewer on the third Tab |
| BUG-QA1-5 | Minor | bl-frontend (or bl-designer if the app's wording is preferred) | ui/spec: two accessible labels differ from `docs/design-specs.md` |
| BUG-QA1-6 | Important | bl-devops first (unexplained) | env: intermittent `ERR_SSL_BAD_RECORD_MAC_ALERT` on browser uploads to Supabase storage |

## Unverified

- **Live GoHighLevel** (US-009, US-010, US-014 except AC-014.4, US-017): `GHL_LOCATION_ID` and the token are unset; covered offline only.
- AC-002.4 "is not stored" (SQ-8); AC-005.7 server-side path (a photo URL that cannot be signed: the browser-side path fails, BUG-QA1-3); AC-016.2 finger drag (SQ-9).
- AC-001.13, AC-002.9 (database and bucket region), AC-007.7 and FR-21 (status-change history and `events`): nothing outside the database exposes them (SQ-1, SQ-3). AC-005.5, AC-016.10: need 51 requests (SQ-6).
- The 4G profile (9 Mbps, 170 ms) is my assumption (SQ-2); AC-002.7 depends on it.
- Whether `vercel.live` also loads on the production domain (the test ran on a preview only).
- Axe on Pipeline and detail inside `screens.both` (the test stops at the first failing screen); the same pages are covered by BUG-QA1-2's other tests, all with the one violation. After the header link is fixed, other violations may show.
- Why the TLS errors happen (BUG-QA1-6).
