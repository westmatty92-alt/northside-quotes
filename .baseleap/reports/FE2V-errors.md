# FE2V tickets

One ticket. Found on the staging preview, commit 0dff609, 2026-11-24.

## BUG-FE2V-1 · SCR-08 photo viewer at 1280 x 800: the photo frame covers the Previous / Next buttons and the reference line

- **Severity:** Important (a control is partly hidden on an ordinary laptop window; no data is lost)
- **AC / test:** AC-012.1, design-specs SCR-08 "Layout" (Previous / Next at the bottom, reachable). Failing test: `tests/e2e/visual/fe2-screens.both.spec.ts` > "FE2V SCR-08 photo viewer, opened with the "View photo 2" button", project `desktop`. The `phone-staff` (390 x 844) run of the same test passes.
- **Steps to reproduce:**
  1. Sign in as the owner on the staging preview, desktop window 1280 x 800.
  2. Open a request that has 3 photos (for example the QA-E2E "Spine" request or NQ-9P7ZRM).
  3. Press "View photo 2".
- **Expected:** the dialog shows "Photo 2 of 3", the reference and name line, Close, the photo in a 4:3 frame, and the Previous photo / Next photo buttons, with nothing on top of anything else (mockup `docs/design/screens/SCR-08-desktop.png`, drawn at 900 px high, where the frame ends 28 px above the buttons).
- **Actual:** the 960 x 720 frame is centred in a 800 px dialog, so it starts 42 px below the top and ends at 762 px. Measured by the test:
  - the photo covers the reference and name line: 187 x 21 px
  - the photo covers "Previous photo": 96 x 22 px (top half of the 44 px button; the label is partly hidden)
  - the photo covers "Next photo": 96 x 22 px
  Identical on the first try and on the retry, so not flaky. A window shorter than 800 px (a laptop with browser toolbars is often about 650 px) is expected to be worse; not measured.
- **Evidence:** `docs/qa-reports/visual/FE2/1280/SCR-08-photo-viewer.png` and `.json` (`layout` has every box, `covered` the list above); `test-results/visual-fe2-screens.both-st-b79c5-ith-the-View-photo-2-button-desktop/` (trace, video). Request ids of the page loads: `yul1::yul1::5ndhx-1795567653259-9f0ff90d57a2` (staff/me), `yul1::yul1::pqhpw-1795567654367-d681bf54a783` (photos). The API answers 200 with every photo URL; axe, console and network are clean.
- **Class hint and owner:** `ui` -> frontend. The frame has a fixed 4:3 size at desktop widths and does not shrink to the height left between the top bar and the button row. It needs to fit the available height (keeping 4:3) at 1280 x 800 and shorter.
- **Signature suggestion:** `FE2 SCR-08 photo frame fixed at 960x720 does not fit viewport height; overlaps Previous/Next and the reference line at 1280x800`
- **Regression test:** already in the suite (the overlap assertion in the SCR-08 test); it stays. It must pass on the redeployed preview with no change to the assertion.
