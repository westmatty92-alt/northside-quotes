# FE2V tickets

Status at the re-run (staging commit 42208a4, 2026-11-24): BUG-FE2V-1 RESOLVED; BUG-FE2V-2 OPEN (minor, new).

## BUG-FE2V-2 · The Move to button's accessible name does not gain ", saving" while a move is saving (OPEN, minor)

- **Severity:** Minor (the card shows the word "Saving" and the button is `aria-disabled`; nothing is lost, the spec'd name is missing)
- **AC / test:** AC-016.13 (the card shows Saving), `docs/design-specs.md` MoveToMenu: accessible name "Move to another status, NQ-7K3M9P, saving" while it saves. Evidence test: `tests/e2e/visual/dv1-evidence.desktop.spec.ts` > "DV1 SCR-05 the Move to button in its Saving state at 1280 px". It records the name and does not fail on it (the DV1 captures are not gates), and `tests/e2e/support/ui.ts` `moveButton()` accepts the name with or without ", saving", so no existing test fails.
- **Steps to reproduce:**
  1. Sign in as the owner on the staging preview, 1280 x 800, open Pipeline.
  2. Hold the status-change request (a Playwright route that waits), then use a card's Move to menu to choose another status.
  3. While the card shows "Saving", read the Move to button's accessible name.
- **Expected:** "Move to another status, NQ-xxxxxx, saving" (design-specs, MoveToMenu).
- **Actual:** "Move to another status, NQ-GBG78M" (unchanged). The button has `aria-disabled="true"` and a dashed border; the card has a status region reading "Saving".
- **Evidence:** `docs/qa-reports/visual/DV1/SCR-05-move-to-saving-1280x800.json` (`move_to_saving_accessible_name`, `accessible_name_says_saving: false`), `.png` and `-card.png`.
- **Class hint and owner:** `ui` -> frontend (or `spec` -> designer if the status-region announcement is meant to replace the name suffix; the spec text and the mockup state sheet say the suffix).
- **Signature suggestion:** `FE2 MoveToMenu saving state: accessible name lacks ", saving" suffix (design-specs MoveToMenu)`
- **Regression test:** the recorded boolean `accessible_name_says_saving` in the DV1 evidence JSON. If frontend fixes it, tell QA and the evidence test can assert it.

## BUG-FE2V-1 · SCR-08 photo viewer at 1280 x 800: the photo frame covers the Previous / Next buttons and the reference line (RESOLVED at 42208a4)

**Resolution, re-run at 42208a4 (2026-11-24):** `npx playwright test tests/e2e/visual` exits 0, and the SCR-08 test (the overlap assertion, unchanged) passes at 1280 x 800 and at 390 x 844, first try, no retry. Measurements at 1280 x 800: `covered` is `[]`; the photo is 857.7 x 643.2 px (4:3), y 80.8 to 724.0; Previous / Next photo (240 x 44) start at y 740, a 16 px gap; the reference line (y 42.3 to 63.3) and Close are above the frame. Extra, at 1280 x 720: photo 751 x 563.3, y 80.8 to 644.0, buttons at y 660 (16 px gap), `covered` `[]`, the dialog does not scroll. Evidence: `docs/qa-reports/visual/FE2/1280/SCR-08-photo-viewer.json`, `docs/qa-reports/visual/DV1/SCR-08-photo-viewer-1280x{800,720}.json/.png`. The original report follows.

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
