# STEP FE2V — FE2 visual evidence on staging
## Attempt 1 — 2026-11-24
**Status:** partial (the evidence is complete; one real product bug makes the Playwright command exit 1)
**Files changed:**
- tests/e2e/visual/fe2-screens.both.spec.ts — 9 checks x 2 widths (the `.both.spec.ts` name makes the existing `phone-staff` and `desktop` projects run it; playwright.config.ts is untouched)
- tests/e2e/visual/evidence.ts — screenshot, console and network recorder, axe (all violations written, serious/critical fail), evidence JSON
- docs/qa-reports/visual/FE2/README.md — pass/fail table, staging URL, commit, deviations
- docs/qa-reports/visual/FE2/{390,1280}/*.png and *.json, docs/qa-reports/visual/FE2/deployment.json — evidence
- .baseleap/reports/FE2V-errors.md — BUG-FE2V-1
- docs/qa-reports/qa-e2e-created.ndjson (outside my owned paths, shared harness side effect): `auth.setup.ts` empties it at the start of every run; I restored the same 8 lines by hand after each run. docs/qa-reports/playwright-results.json is rewritten by the config's reporter.
**Acceptance criteria:**
- Every FE2 screen at 390 and 1280: SCR-03 signed out, SCR-03 wrong password (throwaway email), SCR-04 with data, SCR-06 ticked and unticked, SCR-08 opened with "View photo 2", SCR-07 strip → 17 of 18 pass; SCR-08 at 1280 fails on a real bug (BUG-FE2V-1).
- Screenshot, console errors, failed requests, axe serious/critical → all recorded per screen; 0 console errors, 0 unexpected failed requests, 0 axe violations of any impact on every screen.
- Compared with docs/design/screens → deviations listed in the README; no test fails on pixels.
**Commands run:**
- `npx tsc --noEmit` → exit 0; `npx eslint tests/e2e/visual` → exit 0
- `npx playwright test tests/e2e/visual` (first run, before the overlap assertion existed) → exit 0, 19 passed
- `npx playwright test tests/e2e/visual` (final) → exit 1, 18 passed, 1 failed: desktop SCR-08, same failure on the retry (not flaky)
- `test -s docs/qa-reports/visual/FE2/README.md` → exit 0 (file written; not run as a separate command here)
**Could not do:** an exit-0 Playwright run, because the failing check is a real bug and I did not weaken it. SCR-08 at a 900 px-high window is unverified (the config has one desktop height). GoHighLevel states other than failed / not copied are unreachable on staging.
**CONTRACT QUESTION:** none
**BLOCKED:** none
**Notes for the next step:**
- The ledger's `npx playwright test tests/e2e/visual` will exit 1 until frontend fixes SCR-08 and staging is redeployed; re-run it then (a reopen), no test change needed.
- Each run empties docs/qa-reports/qa-e2e-created.ndjson (the `setup` project). The data stays on staging. Consider having that reset only in the run that creates the data.
- Submissions this step: 0. Failed sign-ins with a throwaway address: 2 per run (4 in all). Staff accounts: signed in only, never locked.
- The SCR-06 checks take about 20 s because they read every tagged request's detail through the API to pick one.
