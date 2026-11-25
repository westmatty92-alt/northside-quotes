# QA Run Report

**Verdict: PASS for everything this suite can reach.** 156 of 156 tests passed in one full run at `04dd79a`, with 0 failed, 0 flaky and 0 skipped. No new bug. BUG-QA1-6 (intermittent TLS errors on uploads) did not recur and is still **not proven gone** (see below). Not covered here: live GoHighLevel, the database and bucket region, the status-change history and events table, the 51-request criteria, and everything QA2 owns (permission probes, fuzz, lockout and abuse). Those are under "Unverified" and are not part of this verdict.

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Commit under test:** `04dd79a77521284fdf0d7754e48ac650523be10f` (read from `/api/health`, status `ok`; recorded in `docs/qa-reports/deployed-version.json` by `platform › health`, and in `docs/qa-reports/visual/FE2/deployment.json` by the FE2V spec) · **Step:** QA1, attempt 5 (regression after the code- and security-review fixes REV-1 to REV-4, SEC-25, contract corrections A3, BE2 404/415, BE1 surrogate) · **Date:** 2026-11-25 · **Run type:** preflight, then the full suite once: `npx playwright test tests/e2e --grep-invert @probe` (run id `oxsdn`, started 22:24 UTC, 12.0 min).
Evidence: `docs/qa-reports/playwright-results.json` (JSON reporter: expected 156, unexpected 0, flaky 0, skipped 0) and `playwright-report/` (HTML). Failure traces would be in `test-results/` (git-ignored; they hold the bypass header, do not share). There were no failures, so there are none.

## The commit check is now durable

`platform › health` and `fe2-screens › FE2V the preview serves the commit under test` read the expected commit from `QA_EXPECTED_SHA` when it is set. When it is not set (this run: the ledger cannot pass an environment variable) they assert only that `/api/health` is `ok` and the version is 40 hex characters, and they write the version they saw to the two JSON files above. The commit in this report is that recorded version. The same run therefore cannot pass against a build with no commit, and the pinned form is one variable away (`QA_EXPECTED_SHA=<sha>`, optionally `QA_WAIT_BUILD_MS`).

## Preflight: PASSED

| Check | Expected | Observed |
|---|---|---|
| `GET /api/health` version | `04dd79a` | First checks, after the brief: `4b20835…` (the new build had not landed; two checks). Third check, within the 10-minute allowance: `04dd79a77521284fdf0d7754e48ac650523be10f`, status `ok`. Again at the start of the full run: pass |
| `GET /` | 200 | 200 (`platform › SEC-2`: page with a form token, `Cache-Control: no-store`, two loads carry different nonces) |
| `POST /api/quote-requests`, made-up token | 401 `form_token_invalid` | 401 |
| `GET /inbox` | 404 | 404 |

## Counts

| Run | Tests | Passed | Failed | Flaky (retry) | Skipped | Duration |
|---|---|---|---|---|---|---|
| Full run (`oxsdn`) | 156 | 156 | 0 | 0 | 0 | 12.0 min |

156 = the 130 of the last pass + 25 visual-evidence tests that were added after it (`visual/fe2-screens.both` 16, `visual/dv1-evidence` 9; they read tagged requests and submit nothing except one DV1 evidence request) + 1 new REV-2 test. Tests that create requests run with retries off (a retry would spend the 5-per-10-minutes limit), so Playwright cannot flag them FLAKY; there was no failure for me to flag by hand. By project: setup 3, preview 4, phone 4, phone-staff 65, desktop 77, phone-late 3.

## Done spine: PASSED

All six steps passed in 19.4 s: the homeowner sends with 3 photos and sees an NQ- reference; the owner signs in and sees it first; price and note survive a reload; Won from the list; Won again from the board; the weekly Won count moved within 2 s. No console error, no failed request, no third-party host other than the allowed `vercel.live` preview toolbar. (`spine.phone › @smoke the homeowner submits with 3 photos…`)

## AC-002.7 timing (15 MB of photos on QA's 4G profile, ruling SQ-2: the profile is the reference)

Profile: 9 Mbps down and up, 170 ms round trip, three photos of 5,242,880 bytes, double tap on Send, time from the tap to the confirmation page. Limit: 20 000 ms.

| Run | Measured | Result |
|---|---|---|
| Attempt 5, `oxsdn` (04dd79a) | **18 303 ms** | pass |
| Attempt 4, run 2 (0dff609) | 19 387 ms | pass |
| Attempt 3 (earlier build) | 20 173 ms once | one marginal fail |

Margin 1.7 s. The transfer alone at 9 Mbps is about 13.3 s. One measurement per run; the value moves by about 1 s between runs, so the margin is real but small. A slower real 4G connection would exceed the limit. Reported as measured.

## REV-2 (same-token resend with a swapped photo): PASS

New `late › AC-002.6 REV-2 same-token resend after swapping a photo stores the new photo, not the old one` (10.0 s). Photo 2's upload is dropped; the error shows beside photo 2; the person removes photo 2 and adds a PNG of a different size; Send again on the same page (the same form token). Result: one request, 3 photos stored, types jpeg, jpeg, png, and the sha-256 of each signed-URL download matches p1, p3 and the swapped PNG; the removed photo's bytes are not stored. That is the behaviour REV-2 changed. Not verified: that this test fails on the build before REV-2 (no such build is deployed; I did not run it against one).

## Acceptance criteria (mapping in `docs/test-plan.md`)

**Pass** (every test that carries the criterion passed):
AC-001.1 .2 .3 .4 .5 .6 .7 .8 .9 .10 .11 .12 .14 .15 .16 .17 .18 · AC-002.1 .2 .3 .5 .6 (and the REV-2 swap) .7 .8 · AC-003.1 .2 (page side) .6 · AC-004.1 .2 .3 .4 .6 .7 .9 .10 .14 · AC-005.1 .2 .3 .6 .7 .8 .9 .10 · AC-006.1 .2 .3 .4 .5 .6 .7 · AC-007.1 .2 .3 .4 .5 .6 · AC-008.1 .2 .5 .8 · AC-010.6 · AC-011.1 .3 .4 · AC-012.1 .2 · AC-013.1 .2 .3 · AC-014.4 · AC-015.1 .2 · AC-016.1 .2 (mouse, grip touch drag, Move to) .3 .5 .6 .7 .8 .9 .12 .13 .14 .15 .16 .17 .18 .19 .20 · AC-017.16 · FR-1, FR-2, FR-26 · design checks: photo viewer focus trap (SCR-08), photo and Move to wording (SQ-10) · FE2V visual evidence at 390 and 1280 px (axe 0 serious or critical, no undeclared console error or failed request).

**Pass, with a stated limit:**
- AC-002.4: the refusal message "Photos must be JPEG, PNG or WebP" shows in the file's own row; "is not stored" is **unverified** (SQ-8, still waiting for PM or designer).
- AC-002.7: passes, 18 303 ms; margin 1.7 s (see above).

**Fail:** none.

## What the fixes changed, as seen from the browser

| Fix | Seen in this run |
|---|---|
| REV-2 photo plan on same-token resend | `late › AC-002.6 REV-2` (above); the older `late › AC-002.6` (same photos, Send again) also passes, so an unchanged plan still completes the same request |
| BE2 404/415, BE1 surrogate, A3 contract corrections, SEC-25 fuzz environment | No browser-visible change; no test in this suite regressed. Covered by QA2's probes and fuzz, which this run does not repeat |
| REV-1 GHL stage tags | Needs live GoHighLevel; not reachable here (see "Unverified") |
| REV-3, REV-4 backend test isolation | Not a staging behaviour |

## BUG-QA1-6 (intermittent TLS errors on direct Supabase photo uploads): did not recur, not proven gone

- This run: 5 test executions upload photos (the spine, the double-tap with 3 x 5 MB, the upload-drop, the REV-2 swap, and the DV1 evidence request): 0 occurrences of `ERR_SSL_BAD_RECORD_MAC_ALERT` or any other `net::ERR_` (the JSON report and the run output contain none; the console-error guard fails any test that sees one; the only allowed abort is the deliberate photo-2 abort in the two upload-drop tests).
- Since attempt 3, where it appeared in about 2 of 6 photo-uploading runs: 3 full runs in a row are clean (2 at `0dff609`, 1 at `04dd79a`). If it were still happening at one run in three, the chance of 3 clean runs is about 30 percent, so this is suggestive, not proof.
- For devops: the failing PUTs were to the project's storage host `ckhkiarvfrfiwkvspduu.supabase.co/storage/v1/object/quote-photos/<request id>/photo-N`, from the QA machine, on 2026-11-23 between about 20:30 and 21:00 local. This run's clean uploads: 2026-11-25 22:24 to 22:36 UTC. Status stays **open (monitor)**.

## Permission probes, fuzz, NFRs

Permission probes and fuzz: not run (QA2; this run excludes `@probe`). No boundary was observed crossed. NFR evidence from this run: AC-001.10 form usable within 3 s on the 4G profile (pass); AC-005.8 list and AC-016.18 board within 2 s on broadband (pass); AC-002.7 see above; axe at `wcag2a, wcag2aa, wcag21a, wcag21aa`: 0 violations on the Request page, sign-in, Requests, Pipeline, request detail and the photo viewer.

## Flaky / quarantined

None. No test is skipped, `fixme`'d or weakened. Test-side changes this attempt are listed in `docs/test-plan.md`, "Changes made in attempt 5" (the commit check, and the new REV-2 test).

## Test data left on staging (tagged `QA-E2E oxsdn …`; requests cannot be deleted through the API, NG-7)

Baseleap removes them by name prefix. This run's 10 requests (also in `docs/qa-reports/qa-e2e-created.ndjson`):

| Reference | Name tag and kind |
|---|---|
| NQ-6RXNKK | `QA-E2E oxsdn Spine Dana Whitfield`: done spine, 3 photos |
| NQ-XU5ZCD | `QA-E2E oxsdn Zoë O'Brien <script>alert(1)</script>`: XSS name, offers ticked, no photos |
| NQ-4XTMVT, NQ-SUJ223 | `QA-E2E oxsdn Back-resend A / B Alex Morgan` |
| NQ-U9DRMA | `QA-E2E oxsdn Double-tap Sam Patel`: 3 x 5 MB photos |
| NQ-DHS7Z8 | `Dana Whitfield QA-E2E oxsdn DV1`: DV1 evidence request, 1 photo (the tag is not at the start of the name) |
| NQ-EDD9MT | `QA-E2E oxsdn Upload-drop Robin Singh` |
| NQ-X5ZDJT | `QA-E2E oxsdn Swap-resend Riley Chen`: REV-2 |
| NQ-X4XTZ6, NQ-FE2Y99 | `QA-E2E oxsdn Consent missing / maybe Pat Lee` |

Earlier attempts' requests share the `QA-E2E ` prefix. The staff tests also change the status, price and note of requests on the shared staging list, so those fields on the requests above (and on any other request they pick from the list) are not as they were. The FE2V spec made two failed sign-ins with a throwaway address (one per width); no staff account was used for a failed sign-in.

## Tickets

| Ticket | Severity | Status |
|---|---|---|
| BUG-QA1-1 to BUG-QA1-5 | various | RESOLVED (attempts 3 and 4); no regression at `04dd79a` |
| BUG-QA1-6 | Important | OPEN (monitor): did not recur in 3 full runs in a row |
| New tickets | | none |

## Unverified

- **Live GoHighLevel** (US-009, US-010, US-014 except AC-014.4, US-017, and so REV-1's stage-tag convergence): `GHL_LOCATION_ID` and the token are unset; covered offline only (INT1/INT2 simulators).
- AC-002.4 "is not stored" (SQ-8); AC-005.7 server-side path (a photo URL the server could not sign, `url: null`): only the browser-side failure was exercised.
- AC-001.13, AC-002.9 (database and bucket region), AC-007.7 and FR-21 (status-change history and `events`): nothing outside the database exposes them (SQ-1, SQ-3). AC-005.5 and AC-016.10: need 51 requests (SQ-6).
- AC-002.7 for real 4G conditions: only QA's 4G profile was measured; the margin is 1.7 s.
- Whether the REV-2 test fails on the pre-REV-2 build; I had no such build to run it against.
- Whether `vercel.live` also loads on the production domain.
- The cause of BUG-QA1-6, and whether it is gone.
- Mouse drag on the board does not require the grip; that was not specified by the ruling and is not asserted either way.
- `tests/e2e/support/wait-for-build.mjs` is still not run (`node` on it needs approval in this session); the preflight wait used repeated runs of the `health` test instead.
