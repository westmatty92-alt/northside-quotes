# FE2 visual evidence (STEP FE2V)

- **Target:** https://northside-quotes-git-staging-baseleap.vercel.app (staging preview, never local, never production)
- **Commit under test:** `0dff6097e8e258c64507911f58543c0c1258f64f` (read from `/api/health`, recorded in `deployment.json`; the suite fails if it does not contain `0dff609`)
- **Run:** 2026-11-24, Playwright (chromium), projects `phone-staff` (390 x 844, touch) and `desktop` (1280 x 800), signed in with the saved owner session from `auth.setup.ts`; the bypass header goes to the staging host only.
- **Re-run:** `npx playwright test tests/e2e/visual` (spec: `tests/e2e/visual/fe2-screens.both.spec.ts`, recorder: `tests/e2e/visual/evidence.ts`).
- **Verdict: FAIL on one product bug.** 17 of 18 screen checks pass; SCR-08 at 1280 px fails (the photo covers the Previous / Next buttons). Ticket: `.baseleap/reports/FE2V-errors.md`. The failure is not flaky: it failed on the first try and on the retry, with the same measurements.

## What each check does

Every check takes a screenshot, records console errors and failed requests (the only declared designed error is the 401 of the sign-in route on the wrong-password screen), and runs axe at WCAG 2.0/2.1 A and AA. It fails on any serious or critical axe violation, any console error and any unexpected 4xx/5xx or network failure. Differences from the mockups are noted below and never fail a test. The suite submits nothing and changes nothing on staging; the only writes are two failed sign-ins per run with a throwaway address (`qa-visual-<run>-<width>@example.invalid`), never a staff account.

## Pass / fail

| Screen | State | 390 | 1280 | Console errors | Failed requests | axe serious/critical | Evidence (under `390/` and `1280/`) |
|---|---|---|---|---|---|---|---|
| SCR-03 sign-in | signed out | PASS | PASS | 0 | 0 | 0 | `SCR-03-signed-out.png/.json` |
| SCR-03 sign-in | wrong password, throwaway email | PASS | PASS | 0 | 0 (the designed 401 is listed in `designed_error_responses`) | 0 | `SCR-03-wrong-password.png/.json` |
| SCR-04 Requests | owner, with data (50 rows, then "Show more") | PASS | PASS | 0 | 0 | 0 | `SCR-04-requests.png/.json`, `SCR-04-requests-top.png` (first screen) |
| SCR-06 detail | offers box ticked (NQ-FHMUJG, no photos) | PASS | PASS | 0 | 0 | 0 | `SCR-06-ticked.png/.json` |
| SCR-06 detail | offers box not ticked, "Not copied: no offers consent", no Retry, no stage-tag line (NQ-9P7ZRM, 3 photos) | PASS | PASS | 0 | 0 | 0 | `SCR-06-unticked.png/.json` |
| SCR-08 photo viewer | opened with "View photo 2" (3 photos) | PASS | **FAIL** | 0 | 0 | 0 | `SCR-08-photo-viewer.png/.json` (viewport shot; `covered` and `layout` hold the measurements) |
| SCR-07 weekly strip | on Requests; numbers equal the API's week counts (78 / 10 / 1) | PASS | PASS | 0 | 0 | 0 | `SCR-07-weekly-strip.png/.json` (the strip only; the strip in context is in the SCR-04 shots) |
| Deployment | `/api/health` ok, commit contains `0dff609` | PASS | PASS | n/a | n/a | n/a | `deployment.json` |

axe also reported no moderate or minor violations on any screen (`axe.minor_or_moderate` is empty in every `.json`).

The SCR-08 failure at 1280 x 800: the photo frame (960 x 720) starts 42 px below the top of the dialog and ends 762 px down, so it sits on the second line of the "reference, name" text (187 x 21 px) and on the top half of both the "Previous photo" and "Next photo" buttons (96 x 22 px each); the words "Previous photo" and "Next photo" are partly hidden. At 390 px nothing overlaps.

## Deviations from the mockups (`docs/design/screens/SCR-NN-*.png`)

Compared by eye, both widths. Not test failures.

| Screen | Deviation | Weight |
|---|---|---|
| SCR-08, 1280 | The 4:3 frame does not shrink to the window height, so at 800 px it covers the buttons and the reference line (in the 900 px mockup it fits with 28 px to spare). This is the bug above. | Product bug |
| SCR-06, 1280 | The two columns are 50 / 50 (536 px each); the mockup is about 60 / 40 (left 629 px, right 419 px). | Minor, visible |
| SCR-06 and SCR-04, 1280 | Content starts at x=96 and ends at x=1184; the mockup is 104 to 1176. The top bar is likewise 8 px wider on each side (wordmark at x=20, Sign out ends at x=1264; mockup 28 and 1256). | Minor |
| SCR-04, 1280 | The "Move to" button is about 137 px wide; the mockup's is about 150 px. Column positions in the table shift a little with it. | Minor |
| SCR-03, 1280 | The card is 440 px wide and starts at y=112; the mockup's is about 406 px wide starting at y=97. The real value matches the spec text ("440 px maximum"); the mockup is the narrower one. | Cosmetic |
| SCR-06 and SCR-08, both | Photo tiles and the viewer show the real photos with a dark "View photo N" chip; the mockup draws a grey stand-in with an icon. Expected, the mockup says so. At 390 px the chip wraps onto two lines ("View photo" / "1"); the mockup keeps one line. | Minor |
| SCR-03 error and SCR-08 | The mockups show a focus ring on the error notice and on Close. The live screenshots show none (focus is on Close, which the test asserts; the ring is probably hidden because the dialog was opened with a mouse click). Unverified for keyboard use. | Not assessed |
| SCR-06 ticked | The ticked request on staging shows "Copy to GoHighLevel failed / Stage tag failed" with Retry copy (mockup state 2), not the primary mockup's "Copied". Expected: GoHighLevel is not connected on staging, so the live state is "failed". The layout matches the mockup's state sheet. | Environment |
| SCR-06 / SCR-04 / SCR-07 mobile | Match the mockups: header, tag, cards, bottom tab bar, filter and search, three tiles with "Requests this week" on two lines. | none |
| SCR-03 mobile, SCR-06 unticked (the "Not copied: no offers consent" card and its wording) | Match the mockups. | none |

Screenshot artefacts, not defects: the full-page captures of SCR-06 on a phone draw the fixed bottom tab bar part-way down the page, and the 390 px SCR-04 full-page shot is 10,000 CSS px tall (50 rows); `SCR-04-requests-top.png` is the first screen of it. Names such as "QA-E2E dwhik Consent maybe Pat Lee" are tagged test data and wrap in the rows; the name `<script>alert(1)</script>` is drawn as plain text on SCR-04 and SCR-06 (AC-001.5).

## Notes

- Submissions made: 0 (the 5 per 10 minutes limit is untouched). Failed sign-ins with the throwaway address: 2 per run.
- The shared `auth.setup.ts` empties `docs/qa-reports/qa-e2e-created.ndjson` at the start of every run. After each run it was restored by hand to the 8 lines it held before (the requests are still on staging).
- Not covered by this step: GoHighLevel states other than "failed" and "not copied" (not reachable on staging), the SCR-08 error and loading states, SCR-04 empty and error states, the Pipeline tab.
