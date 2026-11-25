# QA Run Report

**Verdict: PASS for everything this suite can reach.** 130 of 130 tests passed, twice in a row, with 0 failed, 0 flaky and 0 skipped. BUG-QA1-2 to BUG-QA1-5 are resolved. BUG-QA1-6 (intermittent TLS errors on uploads) did not recur in two full runs but is **not proven gone** (see below). Not covered here: live GoHighLevel, the database and bucket region, the status-change history and events table, the 51-request criteria, and everything QA2 owns (permission probes, fuzz, lockout and abuse). Those are listed under "Unverified" and are not part of this verdict.

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Commit under test:** `0dff609` (`/api/health` version starts `0dff609`; asserted by `platform › health`) · **Step:** QA1, attempt 4 (re-run after FE2 fixes) · **Date:** 2026-11-24 · **Run type:** preflight, then the full suite twice: `npx playwright test tests/e2e --grep-invert @probe` (the form `node --env-file=.env.local node_modules/.bin/playwright test …` is refused in this session; `playwright.config.ts` loads `.env.local` itself, so the two run the same suite).
Evidence: `docs/qa-reports/playwright-results.json` (run 2, JSON reporter) and `playwright-report/` (run 2, HTML). Run 1 was started with `--reporter=list` by mistake, so it left no JSON or HTML; its full list output (130 passed, 10.9 min) is recorded here and was the reason for the second run. Failure traces would be in `test-results/` (git-ignored; they hold the bypass header, do not share). There were no failures, so there are none.

## Preflight: PASSED

| Check | Expected | Observed |
|---|---|---|
| `GET /api/health` version | starts `0dff609` | First check, a few minutes after the brief: still `e966fbc` (the new build had not landed). On the next check, within the 10-minute allowance: version contains `0dff609`, status `ok`. Then again at the start of each full run: pass |
| `GET /` | 200 | 200 (`platform › SEC-2`: page with a form token, `Cache-Control: no-store`, two loads carry different nonces) |
| `POST /api/quote-requests`, made-up token | 401 `form_token_invalid` | 401 |
| `GET /inbox` | 404 | 404 |

## Counts

| Run | Tests | Passed | Failed | Flaky (retry) | Skipped | Duration |
|---|---|---|---|---|---|---|
| Run 1 (list output only; started 2026-11-24 about 10:51 UTC, run id `kr232`) | 130 | 130 | 0 | 0 | 0 | 10.9 min |
| Run 2 (JSON and HTML kept; started 11:06 UTC, run id `lai62`) | 130 | 130 | 0 | 0 | 0 | 16.0 min |

Run 2 was slower only because it started inside run 1's 10-minute submission window (the form accepts 5 requests per 10 minutes per address), so two tests waited for the limit. Tests that create requests run with retries off (a retry would spend the limit), so Playwright cannot flag them FLAKY; there was no failure in either run for me to flag by hand.

## Done spine: PASSED (2 of 2 runs)

All six steps passed in both runs (18.6 s in run 1, 18.3 s in run 2): the homeowner sends with 3 photos and sees an NQ- reference; the owner signs in and sees it first; price and note survive a reload; Won from the list; Won again from the board; the weekly Won count moved within 2 s. No console error, no failed request, no third-party host other than the allowed `vercel.live` preview toolbar. The spine is stable in this run, but with 2 runs it cannot show that the earlier TLS failure (BUG-QA1-6) is gone.

## AC-002.7 timings (15 MB of photos on QA's 4G profile, ruling SQ-2: the profile is the reference)

Profile: 9 Mbps down and up, 170 ms round trip, three photos of 5,242,880 bytes, double tap on Send, time from the tap to the confirmation page. Limit: 20 000 ms.

| Run | Measured | Result |
|---|---|---|
| Run 1 | not recorded (the test passed, so under 20 000 ms; the whole test took 22.3 s including filling the form and the 4G page load) | pass |
| Run 2 | **19 387 ms** | pass |
| Attempt 3 (earlier build, for history) | 20 173 ms once; under 20 s in the other runs | one marginal fail |

Margin in run 2 is 613 ms. The transfer alone at 9 Mbps is about 13.3 s, so about 6 s is round trips and server work. This is within the limit but close: a slower real 4G connection would exceed it. Reported as measured.

## Acceptance criteria (mapping in `docs/test-plan.md`)

**Pass** (every test that carries the criterion passed in both runs):
AC-001.1 .2 .3 .4 .5 .6 .7 .8 .9 .10 .11 .12 .14 .15 .16 .17 .18 · AC-002.1 .2 .3 .5 .6 .7 .8 · AC-003.1 .2 (page side) .6 · AC-004.1 .2 .3 .4 .6 .7 .9 .10 .14 · AC-005.1 .2 .3 .6 .7 .8 .9 .10 · AC-006.1 .2 .3 .4 .5 .6 .7 · AC-007.1 .2 .3 .4 .5 .6 · AC-008.1 .2 .5 .8 · AC-010.6 · AC-011.1 .3 .4 · AC-012.1 .2 · AC-013.1 .2 .3 · AC-014.4 · AC-015.1 .2 · AC-016.1 .2 (mouse, grip touch drag, Move to) .3 .5 .6 .7 .8 .9 .12 .13 .14 .15 .16 .17 .18 .19 .20 · AC-017.16 · FR-1, FR-2, FR-26 · design checks: photo viewer focus trap (SCR-08), photo and Move to wording (SQ-10).

**Pass, with a stated limit:**
- AC-002.4: the refusal message "Photos must be JPEG, PNG or WebP" shows in the file's own row; "is not stored" is **unverified** (SQ-8, still waiting for PM or designer to confirm the row may stay).
- AC-002.7: passes, 19 387 ms in the run that recorded it; margin 0.6 s (see above).

**Fail:** none.

## Tickets resolved by FE2 (evidence: the same tests that failed in attempt 3 now pass, in both runs)

| Ticket | Was | Evidence it is fixed |
|---|---|---|
| BUG-QA1-2 (Critical) | Staff header logo link failed axe `label-content-name-mismatch` on Requests, Pipeline and detail; 4 smoke tests red | Axe now reports 0 violations on those screens: `auth.desktop › AC-004.1`, `requests › AC-005.10 AC-016.19` (phone and desktop), `board › AC-016.1 AC-016.8`, `pipeline.phone › AC-016.17`, `detail › AC-005.3 AC-016.5` (both), `screens › AC-016.16 AC-005.10` (both) all pass |
| BUG-QA1-3 (Important) | No "Photo unavailable" when a photo cannot load | `detail › AC-005.7` passes on phone and desktop with the storage requests aborted |
| BUG-QA1-4 (Important) | Third Tab left the photo viewer | `detail › design: focus is trapped inside the open photo viewer` passes on phone and desktop |
| BUG-QA1-5 (Minor) | Two accessible labels differed from the design | Resolved by ruling (2026-11-24): design-specs now matches the app. `detail › design wording (SQ-10)` and `requests › design wording (SQ-10)` pass on both, asserting "View photo N of 3 at full size" and "Move to another status, NQ-…" and that the visible words start the name |
| SQ-9 (not a ticket) | Finger drag did not move a card | Ruled: touch drag works by the grip at 1280 px. `board › AC-016.2 SQ-9 touch drag by the grip` passes; `pipeline.phone › AC-016.17` asserts no grip is visible at 375 px and moves a card with Move to; the spine does Move to at 390 px |

## BUG-QA1-6 (intermittent TLS errors on direct Supabase photo uploads): did not recur, not proven gone

- This attempt: 2 full runs, each uploading photos in three tests (the spine, the double-tap with 3 x 5 MB, and the upload-drop test): 0 occurrences of `ERR_SSL_BAD_RECORD_MAC_ALERT` or any other `net::ERR_` (the run-2 JSON report contains none; the console-error guard fails any test that sees one). Run 1 also passed with the guard on.
- Earlier: it happened in 2 of about 6 photo-uploading runs in attempt 3 (spine once, AC-002.6 once, plus a first AC-002.6 occurrence), so 0 in 2 is consistent with a rate of up to about one run in three still being there (probability of 0 in 2 at that rate is about 0.44). Not enough to close it.
- Where and when, for devops: the failing PUTs were to the project's storage host `ckhkiarvfrfiwkvspduu.supabase.co/storage/v1/object/quote-photos/<request id>/photo-N`, from the QA machine, on 2026-11-23 between about 20:30 and 21:00 local (request ids of the creating calls are in `.baseleap/reports/QA1-errors.md`). This attempt's runs, with no error, were on 2026-11-24 from about 10:51 to 11:22 UTC. Status stays **open (monitor)**.

## Permission probes, fuzz, NFRs

Permission probes and fuzz: not run (QA2; no lockout or abuse probe was run). No boundary was observed crossed. NFR evidence from this run: AC-001.10 form usable within 3 s on the 4G profile (pass); AC-005.8 list and AC-016.18 board within 2 s on broadband (pass); AC-002.7 see above; axe at `wcag2a, wcag2aa, wcag21a, wcag21aa`: 0 violations on the Request page, sign-in, Requests, Pipeline, request detail and the photo viewer.

## Flaky / quarantined

None. No test is skipped, `fixme`'d or weakened. Test-side changes this attempt are corrections for the 2026-11-24 rulings (listed in `docs/test-plan.md`, "Changes made in attempt 4").

## Test data left on staging (tagged `QA-E2E <run id> …`; requests cannot be deleted through the API, NG-7)

Baseleap removes them by name prefix. This attempt's two runs (16 requests; `docs/qa-reports/qa-e2e-created.ndjson` holds run 2 only, run 1 is listed here):

| Run | Reference | Name tag and kind |
|---|---|---|
| `kr232` | NQ-5KBWYV | `QA-E2E kr232 Spine Dana Whitfield`: done spine, 3 photos |
| `kr232` | NQ-5B8E4Z | `QA-E2E kr232 Zoë O'Brien <script>alert(1)</script>`: XSS name, offers ticked, no photos |
| `kr232` | NQ-XCNWGZ, NQ-S9MM2J | `QA-E2E kr232 Back-resend A / B Alex Morgan` |
| `kr232` | NQ-DV7CSV | `QA-E2E kr232 Double-tap Sam Patel`: 3 x 5 MB photos |
| `kr232` | NQ-92BFFE | `QA-E2E kr232 Upload-drop Robin Singh` |
| `kr232` | NQ-DGK3W6, NQ-UBNU34 | `QA-E2E kr232 Consent missing / maybe Pat Lee` |
| `lai62` | NQ-RHMC2X | `QA-E2E lai62 Spine Dana Whitfield` |
| `lai62` | NQ-ARZR2U | `QA-E2E lai62 Zoë O'Brien <script>alert(1)</script>` |
| `lai62` | NQ-H77AU6, NQ-W23D5Z | `QA-E2E lai62 Back-resend A / B Alex Morgan` |
| `lai62` | NQ-BR7R8X | `QA-E2E lai62 Double-tap Sam Patel` |
| `lai62` | NQ-WX88D9 | `QA-E2E lai62 Upload-drop Robin Singh` |
| `lai62` | NQ-ZEMX6H, NQ-W2UZ5E | `QA-E2E lai62 Consent missing / maybe Pat Lee` |

Earlier attempts' requests (attempt 3, roughly 40, count not exact) share the same `QA-E2E ` prefix. The staff tests also change the status, price and note of requests on the shared staging list, so those fields on the requests above (and on any other request they pick from the list) are not as they were.

## Tickets

| Ticket | Severity | Status |
|---|---|---|
| BUG-QA1-1 | was Critical | RESOLVED (attempt 3) |
| BUG-QA1-2 | was Critical | **RESOLVED** (attempt 4) |
| BUG-QA1-3 | was Important | **RESOLVED** (attempt 4) |
| BUG-QA1-4 | was Important | **RESOLVED** (attempt 4) |
| BUG-QA1-5 | was Minor | **RESOLVED** (ruling, attempt 4) |
| BUG-QA1-6 | Important | OPEN (monitor): did not recur in 2 runs |
| New tickets | | none |

## Unverified

- **Live GoHighLevel** (US-009, US-010, US-014 except AC-014.4, US-017): `GHL_LOCATION_ID` and the token are unset; covered offline only (INT1/INT2 simulators).
- AC-002.4 "is not stored" (SQ-8); AC-005.7 server-side path (a photo URL the server could not sign, `url: null`): only the browser-side failure was exercised.
- AC-001.13, AC-002.9 (database and bucket region), AC-007.7 and FR-21 (status-change history and `events`): nothing outside the database exposes them (SQ-1, SQ-3). AC-005.5 and AC-016.10: need 51 requests (SQ-6).
- AC-002.7 for real 4G conditions: only QA's 4G profile was measured, the margin is 0.6 s.
- Whether `vercel.live` also loads on the production domain.
- The cause of BUG-QA1-6, and whether it is gone.
- Mouse drag on the board does not require the grip; that was not specified by the ruling and is not asserted either way.
- The `wait-for-build.mjs` helper was written but not run (`node` on it needs approval in this session).
