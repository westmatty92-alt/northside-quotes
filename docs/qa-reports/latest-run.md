# QA Run Report

**Verdict: FAIL** — 4 failing (2 setup sign-ins, 2 platform checks; all on one root cause) · 0 flaky · 117 not run (blocked by that cause) · 9 ACs not tested (reasons in the plan) · fuzz and probes: QA2, not part of this run
**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`; the host is the one the brief expected; `/api/health` answered `ok` and its `version` contains `6ae29eb`) · **Run:** full (`--grep-invert @probe`) · **Step:** QA1 · **Date:** 2026-11-23 · **Duration:** 29 s (setup fails fast; the 117 dependent tests never start)
**Command:** `npx playwright test tests/e2e --grep-invert @probe` (the ledger form `node --env-file=.env.local node_modules/.bin/playwright test …` was refused by the session's permission system, "requires approval"; `playwright.config.ts` loads `.env.local` itself, so the run is the same). Raw results: `docs/qa-reports/playwright-results.json`; traces and screenshots of the failures in `test-results/` (git-ignored).

## Why nothing past the first screen ran

The staging preview cannot take a request or a sign-in. Three symptoms, one cause (ticket **BUG-QA1-1**, Critical, class `env`):

| What | Observed | Request id |
|---|---|---|
| `GET /` (the Request a quote page) | 500 (Next.js error page) | `yul1::yul1::fk5tx-1795472820349-4e071fe2e455` |
| `POST /api/quote-requests` with a made-up form token | 503 `service_unavailable` (the contract says 401 `form_token_invalid`) | `yul1::yul1::h2sml-1795473972424-d4c7f926c3da` |
| `POST /api/auth/sign-in` with the right owner and helper credentials | 503 (the page shows the fail-closed state) | `yul1::yul1::dhb22-1795473947215-e562143f8e3f` |

`docs/SECURITY_MODEL.md` invariant 15 says exactly this is what happens when `APP_SIGNING_SECRET` is missing or shorter than 32 characters in the environment: `GET /` fails, the two form-token routes and sign-in answer 503. QA cannot read Vercel's variables, so which variable is unverified. The `setup` project signs in once per role; it fails, so the `phone`, `phone-staff`, `desktop` and `phone-late` projects do not start (by design: no session, no staff test).

## Done spine (must pass)

| Step | Result |
|---|---|
| 1. Homeowner submits with photos, offers box unticked | **FAIL (observed)**: the page does not load, `GET /` is 500 |
| 2. A reference number `NQ-…` is shown | NOT RUN (blocked by step 1) |
| 3. The owner signs in and sees the request first on Requests | **FAIL (observed)**: owner sign-in answers 503 in `setup` |
| 4. The owner adds a price and a note | NOT RUN |
| 5. Won from the list, and the same on the board | NOT RUN |
| 6. The weekly count updates | NOT RUN |

The spine test is `tests/e2e/spine.phone.spec.ts › done spine › the homeowner submits with 3 photos and the owner prices it and marks it Won on the list and on the board`. Not run, so the spine is **not proven**.

## Also covered, as asked

| Item | Result |
|---|---|
| Tabs are separate addresses (`/requests`, `/pipeline`) | NOT RUN (`req › AC-005.10 AC-016.19`; `auth › AC-004.3`, `AC-004.14`). Seen while developing the suite, not kept as evidence: a signed-out visit to `/requests` is sent to `/sign-in?next=/requests` |
| `/inbox` returns 404 | **pass** (`platform › /inbox returns 404`) |
| Two GETs of `/` have different form-token nonces and `Cache-Control` containing `no-store` | **FAIL** (`platform › SEC-2 …`): the first GET `/` is 500, so no token, so no nonce to compare (BUG-QA1-1) |
| Back and resend never merges two requests | NOT RUN (`subs › AC-001.7 S0 Back and resend`) |
| The 409 stale-version path | NOT RUN (`detail › AC-006.5`, `board › AC-016.12`) |
| Unticked requests show "Not copied: no offers consent" | NOT RUN (`detail › AC-010.6 …`) |
| Sign-out | NOT RUN (`auth › AC-004.9`) |
| Drag with a mouse and a touch pointer, Escape mid-drag, Move to keyboard path | NOT RUN (`board › AC-016.2` mouse and touch, `AC-016.7`, `AC-016.3`) |
| Photo dialog: Escape and focus | NOT RUN (`detail › AC-012.1 AC-012.2`) |
| Form-token routes available (made-up token is 401, not 503) | **FAIL** (`platform › the form-token routes are available …`): 503 |
| Health and deployed commit | **pass** (`platform › health answers ok and reports the commit under test`) |

## Acceptance criteria

93 ACs have a written spec (see `docs/test-plan.md`). **Passed: 0. Failed with direct evidence: AC-001.1 (page does not load) and AC-004.1 (sign-in 503). Not run: 91** (BUG-QA1-1). The other 60 ACs are QA2 probes, offline integration tests, database rules or not testable on a shared staging project, per the plan.

NOT RUN (blocked by BUG-QA1-1): AC-001.2 to .12, .14 to .18 · AC-002.1 to .7 · AC-003.1, .6 · AC-004.2, .3, .4, .6, .7, .9, .10, .14 · AC-005.1, .2, .3, .6 to .10 · AC-006.1 to .7 · AC-007.1 to .6 · AC-008.1, .2, .5, .8 · AC-009.3, .9 (E2E halves) · AC-010.6 · AC-011.1, .3, .4 · AC-012.1, .2 · AC-013.1 to .3 · AC-014.4 · AC-015.1, .2 · AC-016.1 to .9, .12 to .20 · AC-017.16 (E2E half).

| AC | Risk | Test | phone | desktop | Result |
|---|---|---|---|---|---|
| AC-001.1 | H | `spine.phone.spec.ts › done spine …` | fail (page 500) | n/a | **fail** → BUG-QA1-1 |
| AC-004.1 | H | `auth.desktop.spec.ts › AC-004.1`; `auth.setup.ts › sign in as owner` | n/a | fail (503) | **fail** → BUG-QA1-1 |
| all other ACs above | | | not run | not run | **not run** → BUG-QA1-1 |

Covered: 0 of 93 passing · Not covered by a spec: the 9 NOT TESTED ids in the plan.

## Permission probes

Not part of QA1. They are `@probe` tests (QA2) and were excluded with `--grep-invert @probe`. No permission boundary was observed crossed in this run (only the public pages, the health route, the sign-in route and the form-token routes were touched, each with a made-up or no credential).

## Fuzz

Not part of QA1.

## NFR checks

| Check | Result |
|---|---|
| axe on all screens | NOT RUN (the Request page cannot load; staff screens need sign-in). The sign-in page was checked with axe during development: no serious or critical violations (the test `screens.both › AC-004.1 Sign-in page` is in the suite) |
| 3 s on simulated 4G, 20 s for 3 x 5 MB, 2 s lists | NOT RUN |
| Embed in a GHL iframe | none exists (NG-11) |
| Live GoHighLevel | **unverified**: `GHL_LOCATION_ID` and the token are unset on staging; the INT1/INT2 offline simulator tests cover the GHL ACs |
| Analytics events | not observable from outside (SQ-3 in the plan) |

## Flaky / quarantined

| Test | Status | Ticket |
|---|---|---|
| none | the two failing platform checks failed identically on the retry (a fail-then-pass would be reported FLAKY) | |

No test is skipped, `fixme`'d or weakened.

## Test data left on staging

None. Nothing was submitted (the form cannot load) and no request was created, so there is nothing to clean up. Future runs tag every request `QA-E2E <run id>` and list them in `docs/qa-reports/qa-e2e-created.ndjson` (this run's list is empty).

## Tickets

| Ticket | Severity | Suggested owner | Title |
|---|---|---|---|
| BUG-QA1-1 | Critical | bl-devops (Matthew sets the value) | Staging preview: `GET /` is 500 and the form-token and sign-in routes answer 503, consistent with `APP_SIGNING_SECRET` missing or short in the Preview environment |

## Notes for the next run

- Reopen QA1 after BUG-QA1-1 is fixed and `staging` is redeployed. The first working run will test the specs against the real screens for the first time: expect a few `test`-class locator fixes (QA's, reported as such), then real findings.
- The run needs about 12 minutes of waiting at worst for the form's 5-per-10-minutes limit (the suite paces itself); a full run will take roughly 25 to 30 minutes.
- Before the next run, `.gitignore` should list `playwright/.cache/` (it does: `/playwright/.cache/`), `test-results/` and `playwright-report/` (both listed). The saved sign-in sessions and the traces contain tokens and the bypass header, so none of those folders may be committed.
