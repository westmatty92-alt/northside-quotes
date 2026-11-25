# FE2 visual evidence (STEP FE2V)

- **Target:** https://northside-quotes-git-staging-baseleap.vercel.app (staging preview, never local, never production)
- **Commit under test (re-run):** `42208a49aaaf21477fd369360f6a17caed80254f` (read from `/api/health`, recorded in `deployment.json`; the suite fails if it does not contain `42208a4`). The first run was at `0dff609`.
- **Run:** 2026-11-24, Playwright (chromium), projects `phone-staff` (390 x 844, touch) and `desktop` (1280 x 800), signed in with the saved owner session from `auth.setup.ts`; the bypass header goes to the staging host only.
- **Re-run:** `npx playwright test tests/e2e/visual` (specs: `tests/e2e/visual/fe2-screens.both.spec.ts` and `tests/e2e/visual/dv1-evidence.{phone,desktop}.spec.ts`; recorders: `evidence.ts`, `dv1.ts`).
- **Verdict at 42208a4: PASS.** The ledger command exits 0: 27 passed, 1 skipped (the SCR-02 capture, which submits a request and so runs once per commit; see the DV1 section), no retries, nothing flaky. BUG-FE2V-1 is **resolved**. One minor finding is ticketed (BUG-FE2V-2, the Move to button's accessible name while saving); it does not fail a check, because the DV1 captures are evidence, not gates.

## Re-run at 42208a4

| Item | Result |
|---|---|
| Preflight | `/api/health` ok, version starts `42208a4` on the first try (no waiting); `GET /` answered 200 (recorded in the SCR-01 captures, `http_status`) |
| BUG-FE2V-1, SCR-08 at 1280 x 800 | **Resolved.** Nothing covers anything: `covered` is `[]`. The photo frame is 857.7 x 643.2 px (4:3), from y 80.8 to 724.0; Previous / Next photo start at y 740, a 16 px gap; the reference line, title and Close are above the frame. At 390 x 844 still nothing overlaps. Before: a 960 x 720 frame covered 187 x 21 px of the reference line and 96 x 22 px of each button |
| DV1 F-01, busy and paused buttons keep 44 px | Confirmed on the Move to button in its Saving state: 44 px high, CSS `min-height: 44px`, dashed border, `aria-disabled="true"`; the normal button is also 44 px |
| DV1 F-05, "View photo N" chip at 390 | By eye in `390/SCR-06-unticked.png`: "View photo 1", "View photo 2" and "View photo 3" each on one line (before: "View photo" / "1" on two) |
| The 18 FE2 checks (9 x 2 widths) | 18 of 18 pass; 0 console errors, 0 unexpected failed requests, 0 axe violations of any impact, on every screen |
| Screens of this run | `390/` and `1280/` hold the new PNG and JSON for each screen; `deployment.json` records host and version |

## DV1 extra evidence (screenshots and axe, not pass/fail gates)

Folder: `docs/qa-reports/visual/DV1/`. Each capture has a `.png` and a `.json` (axe result, console errors, failed requests, page size and sideways-scroll flag, plus measurements). All 10 records: 0 console errors, 0 failed requests, 0 axe violations of any impact, no sideways scroll. File names end in the viewport, `<w>x<h>`.

| Request | Files | Notes |
|---|---|---|
| SCR-05 Pipeline at 390, viewport-sized | `SCR-05-pipeline-390x844.png/.json` | Header, "This week" tiles, filter tabs (New / Quoted / Won / Lost), first column and card, bottom tab bar |
| SCR-05 Pipeline at 1280, viewport-sized | `SCR-05-pipeline-1280x800.png/.json` | Four columns across, first cards visible |
| SCR-04 Requests at 1280, viewport-sized | `SCR-04-requests-1280x800.png/.json` | |
| Move to in its Saving state at 1280, with its height | `SCR-05-move-to-saving-1280x800.png` (viewport), `...-card.png` (the card), `.json` (`move_to_normal`, `move_to_saving`) | Held save, then dropped: the card shows "Saving", its button is paused (dashed border). **44 px** high, CSS min-height 44 px, same as the normal button. 234 px wide. Nothing was stored (the request kept its status; asserted) |
| SCR-08 at 1280 x 800 | `SCR-08-photo-viewer-1280x800.png/.json` | `covered: []`; frame 857.7 x 643.2, 16 px above the buttons; the dialog does not scroll (800 of 800) |
| SCR-08 at 1280 x 720 | `SCR-08-photo-viewer-1280x720.png/.json` | `covered: []`; frame 751 x 563.3 (4:3), y 80.8 to 644; buttons at y 660, 16 px gap; the dialog does not scroll (720 of 720). The frame shrinks with the window height, as it should |
| SCR-01 at 390 and 1280 | `SCR-01-request-form-390x844.png/.json`, `...-1280x800.png/.json`, and `...-full.png` of each | The opened page, nothing typed; `GET /` answered 200 |
| SCR-02 at 390 and 1280 | `SCR-02-confirmation-1280x800.png/.json`, `...-390x844.png/.json`, and `...-full.png` of each | One submission (see below) |

**SCR-02 was not reusable.** The reference number is shown once, with no lookup (NG-3), so an existing request's confirmation cannot be opened again. One request was submitted for it: `NQ-GBG78M`, "Dana Whitfield QA-E2E f77e8 DV1", 1 small photo, offers box left unticked; it is listed in `docs/qa-reports/qa-e2e-created.ndjson`. The same page was photographed at 1280 x 800 and then with the window narrowed to 390 x 844. The 390 capture is therefore a desktop browser window 390 px wide, not an emulated phone (no touch, one pixel per CSS pixel); the layout is the responsive one. The test submits only when the folder holds no capture for the commit under test (`QA_DV1_RECAPTURE=1` forces another), so the ledger's run reports it as skipped and adds nothing to staging.

**Finding from the Saving capture (BUG-FE2V-2, minor).** While saving, the button's accessible name stays "Move to another status, NQ-GBG78M"; `design-specs.md` (MoveToMenu) says it becomes "Move to another status, NQ-7K3M9P, saving". The card does show the word "Saving" (a status region) and the button is `aria-disabled`, so the state is announced some other way; the name does not match the spec. Ticket: `.baseleap/reports/FE2V-errors.md`.

**What was written to staging in this re-run:** one submission (SCR-02), and the two failed sign-ins per full run (two full runs, so four) with the throwaway address (no staff account). The Saving capture holds the save request and drops it; the request is read back and still has its old status.

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
| SCR-08 photo viewer | opened with "View photo 2" (3 photos) | PASS | PASS (was FAIL at 0dff609) | 0 | 0 | 0 | `SCR-08-photo-viewer.png/.json` (viewport shot; `covered` and `layout` hold the measurements) |
| SCR-07 weekly strip | on Requests; numbers equal the API's week counts (78 / 10 / 1) | PASS | PASS | 0 | 0 | 0 | `SCR-07-weekly-strip.png/.json` (the strip only; the strip in context is in the SCR-04 shots) |
| Deployment | `/api/health` ok, commit contains `42208a4` | PASS | PASS | n/a | n/a | n/a | `deployment.json` |

axe also reported no moderate or minor violations on any screen (`axe.minor_or_moderate` is empty in every `.json`).

The SCR-08 failure at `0dff609` (now fixed, history only): at 1280 x 800 the photo frame (960 x 720) started 42 px below the top of the dialog and ended 762 px down, so it sat on the "reference, name" text (187 x 21 px) and on the top half of both the "Previous photo" and "Next photo" buttons (96 x 22 px each). At `42208a4` the measurements are in the "Re-run at 42208a4" table above.

## Deviations from the mockups (`docs/design/screens/SCR-NN-*.png`)

Compared by eye, both widths, **at `0dff609`**. The rows marked "fixed" were re-checked at `42208a4`; the others were not re-compared in this re-run (the screenshots were retaken, the comparison was not repeated), so treat them as unverified at the new commit. Not test failures.

| Screen | Deviation | Weight |
|---|---|---|
| SCR-08, 1280 | Fixed at `42208a4`: the 4:3 frame now shrinks to the window height (643 px high at 800, 563 px at 720) and keeps 16 px above the buttons. At 0dff609 it covered the buttons and the reference line. | Fixed |
| SCR-06, 1280 | The two columns are 50 / 50 (536 px each); the mockup is about 60 / 40 (left 629 px, right 419 px). | Minor, visible |
| SCR-06 and SCR-04, 1280 | Content starts at x=96 and ends at x=1184; the mockup is 104 to 1176. The top bar is likewise 8 px wider on each side (wordmark at x=20, Sign out ends at x=1264; mockup 28 and 1256). | Minor |
| SCR-04, 1280 | The "Move to" button is about 137 px wide; the mockup's is about 150 px. Column positions in the table shift a little with it. | Minor |
| SCR-03, 1280 | The card is 440 px wide and starts at y=112; the mockup's is about 406 px wide starting at y=97. The real value matches the spec text ("440 px maximum"); the mockup is the narrower one. | Cosmetic |
| SCR-06 and SCR-08, both | Photo tiles and the viewer show the real photos with a dark "View photo N" chip; the mockup draws a grey stand-in with an icon. Expected, the mockup says so. At 390 px the chip wrapped onto two lines at 0dff609; fixed at `42208a4`, by eye it is one line ("View photo 1") in `390/SCR-06-unticked.png`. | Fixed |
| SCR-03 error and SCR-08 | The mockups show a focus ring on the error notice and on Close. The live screenshots show none (focus is on Close, which the test asserts; the ring is probably hidden because the dialog was opened with a mouse click). Unverified for keyboard use. | Not assessed |
| SCR-06 ticked | The ticked request on staging shows "Copy to GoHighLevel failed / Stage tag failed" with Retry copy (mockup state 2), not the primary mockup's "Copied". Expected: GoHighLevel is not connected on staging, so the live state is "failed". The layout matches the mockup's state sheet. | Environment |
| SCR-06 / SCR-04 / SCR-07 mobile | Match the mockups: header, tag, cards, bottom tab bar, filter and search, three tiles with "Requests this week" on two lines. | none |
| SCR-03 mobile, SCR-06 unticked (the "Not copied: no offers consent" card and its wording) | Match the mockups. | none |

Screenshot artefacts, not defects: the full-page captures of SCR-06 on a phone draw the fixed bottom tab bar part-way down the page, and the 390 px SCR-04 full-page shot is 10,000 CSS px tall (50 rows); `SCR-04-requests-top.png` is the first screen of it. Names such as "QA-E2E dwhik Consent maybe Pat Lee" are tagged test data and wrap in the rows; the name `<script>alert(1)</script>` is drawn as plain text on SCR-04 and SCR-06 (AC-001.5).

## Notes

- Submissions made: first run 0; re-run 1 (the SCR-02 confirmation). Failed sign-ins with the throwaway address: 2 per full run.
- The shared `auth.setup.ts` empties `docs/qa-reports/qa-e2e-created.ndjson` at the start of every run. After the re-run it was restored by hand to the 8 lines it held, plus the one new line for the SCR-02 request (the requests are still on staging). The ledger's own run will empty it again.
- The only spec change in the re-run: the expected commit default in `fe2-screens.both.spec.ts` went from `0dff609` to `42208a4` (a constant naming the build under test, no assertion changed). New files: `dv1.ts`, `dv1-evidence.phone.spec.ts`, `dv1-evidence.desktop.spec.ts`.
- Not covered by this step: GoHighLevel states other than "failed" and "not copied" (not reachable on staging), the SCR-08 error and loading states, SCR-04 empty and error states, the Pipeline board's moves and error states (covered by QA1's pipeline specs, not re-run here).
