# Visual review DV1: built app against the Northside mockups and DESIGN.md

**Verdict (current, after the re-review at `42208a4`): APPROVED** (0 Critical, 0 Important open; 7 Minor open or unverified, listed for Gate 3). See "Re-review at 42208a4" at the end of this file. The first-review text below is kept as written and is superseded where the re-review says so.

**First-review verdict (at `0dff609`, now superseded): BLOCKED** (1 Important open, 0 Critical, 7 Minor). The brand, the two tabs, the unticked offers box and the "Not copied: no offers consent" label all match the design. The block is one shared defect (F-01): every "paused" button, including the Saving Move to button, collapses to about 23 px tall. It is a one-line fix in `src/components/ui/button.tsx`. Re-review after the fix needs only F-01 and the evidence gaps listed under "Coverage and limits".

**Staging URL:** https://northside-quotes-git-staging-baseleap.vercel.app
**Commit under review:** `0dff609` (confirmed by QA's `docs/qa-reports/visual/FE2/deployment.json`: health ok, version `0dff6097e8e258c64507911f58543c0c1258f64f`)
**Reviewer:** bl-designer · **Step:** DV1 · **Date:** 2026-11-24
**Compared against:** `DESIGN.md`, `docs/design-specs.md`, `docs/user-flows.md`, `design/mockups/SCR-NN-*.html` and `docs/design/screens/*.png`.

## Coverage and limits (read first)

I could not capture the staging preview myself. `VERCEL_AUTOMATION_BYPASS_SECRET` is not available in my shell: `verify-ui` sent an empty bypass header and every capture was Vercel's login page. `node --env-file=.env.local …` is refused in this session, and I did not read `.env.local`. I did not sign in with the staff accounts. So the evidence is a mix, and each finding says which:

| Evidence | What it is | Covers |
|---|---|---|
| **LIVE** | QA's FE2V screenshots of the real staging preview at `0dff609`: `docs/qa-reports/visual/FE2/{390,1280}/`. Each has a sidecar with an axe result (WCAG 2.1 A and AA: no serious or critical, no console errors, no failed requests). | SCR-03 (signed out, wrong password), SCR-04 (structure only), SCR-06 ticked and unticked at both widths, SCR-07 and SCR-08 at 390 |
| **LOCAL** | My own capture of the `lane/frontend` production build run locally with mock data (`.baseleap/reports/DV1-local/`, 24 views, axe at WCAG 2.2 AA tags: 0 violations on every screen that rendered). Local only: not the staging commit, though the lane includes FE1 to FE3 and the FE2 fixes. | SCR-01 (blank, errors, send-failed), SCR-02, SCR-03 (blank, error) at 390 and 1280 |
| **LANE** | The frontend's own earlier mock-driven screenshots in `northside-quotes-wt-frontend/.baseleap/reports/{FE2-states,FE3,FE3-states}/`. Screenshots only; I did not use its report. | SCR-04 menu and error states, SCR-05 board and its states |
| **CODE** | Reading `northside-quotes-wt-frontend/src/**`. The lane HEAD is not the same hash as staging `0dff609`, so a code line is evidence of what the lane builds, not proof of what is on staging. | Root causes |

**Not verified** (the re-review must close these):
- SCR-05 (Pipeline) on staging: QA has not captured it yet. I reviewed it from LANE screenshots only.
- SCR-04 on staging: the full-page screenshot is 21,176 px tall (50 rows) and not legible, so only its axe sidecar was used. SCR-04 visuals come from LANE.
- SCR-01, SCR-02 on staging: reviewed from LOCAL. Only their behaviour is proved on staging, by QA's passing tests (AC-001.15, AC-001.16, AC-001.18).
- SCR-08 at 1280 and every state sheet (loading, empty, error) on staging.
- Keyboard walk-through and visible focus ring: reviewed by reading the code (every control uses `focusRing`; teal bar uses the Paper ring) and by QA's passing focus-trap tests. I did not run them by hand.
- Reduced-motion behaviour: not run.
- Axe at WCAG 2.2 tags on staff screens: QA's scans use 2.1 tags, so 2.5.8 (target size) is not machine-checked there. F-01 is the only target-size problem I found.

## What matches the design (brand and structure)

- **Brand fidelity, pass.** Harbour Teal header and primary buttons, Paper page, Fog cards and columns, Steel Ink text. Copper appears only as the wordmark pipe, the job-tag elbow, the Emergency bar and icon, and the drag outline; never on text, buttons or teal. Wordmark is the supplied SVG at 44 px, Paper text, copper pipe, real Barlow Semi Condensed. Headings render in Barlow Semi Condensed and body in Source Sans 3 (self-hosted, preloaded); glyph shapes match the mockups, not a fallback. (LIVE SCR-03 and SCR-06; LOCAL SCR-01 to SCR-03.)
- **Tokens in code, pass.** A scan of `src/components` and `src/app` found 0 raw hex or rgb values and 0 arbitrary Tailwind values (`text-[#…]`, `p-[13px]`). See F-08 for the small off-scale utilities.
- **Separate Requests and Pipeline tabs, pass.** Top bar at 1280 shows two tabs, current one underlined (LIVE SCR-06 1280: Requests marked); bottom tab bar at 390 with a Fog current tab and a teal top rule (LIVE SCR-06 390). No List / Board switch on any screen. Distinct addresses `/requests` and `/pipeline`, "Back to Requests" on detail (QA's AC-005.10, AC-016.19, AC-016.20 all pass in `docs/qa-reports/latest-run.md`).
- **Unticked offers checkbox, pass.** Blank form shows the box unticked at 390 and 1280 on its own Fog strip, label "Email me offers and news from Northside. This is optional." (LOCAL SCR-01). Code: form state starts `offers: false`, `autoComplete="off"`, no `checked` default. In the errors state it stays ticked as the homeowner left it, as designed (LOCAL SCR-01--errors).
- **"Not copied: no offers consent", pass.** On an unticked request the GoHighLevel card shows the info icon, the words "Not copied: no offers consent", the explanatory sentence, and no Retry copy button and no stage tag line, at 390 and 1280 (LIVE `FE2/390/SCR-06-unticked.png`, `FE2/1280/SCR-06-unticked.png`). A ticked request shows the two lines with icons and words, and Retry copy only when failed (LIVE SCR-06-ticked).
- **States seen and matching the matrix:** SCR-01 errors summary with links, field messages, refused photos and the unchanged offers box; send-failed banner with values kept; SCR-03 wrong-password banner with email kept; SCR-04 "Couldn't load requests. Try again." plus "Count unavailable" (LANE); SCR-05 stale-save banner "This request was changed by someone else. Reload to see the latest." (LANE); SCR-06 "No photos" panel and sync failure states; SCR-08 dialog with Close, Previous and Next.
- **Spacing and layout.** Same hierarchy, reading order and grouping as the mockups on every screen compared. Layout differences left are real data (QA test names, real photo thumbnails instead of the stand-in icon tiles) and are allowed.

## Rulings on the known items

1. **Saving Move to button about 22 px tall (FE3 finding): not accepted. Important, and wider than reported. See F-01.** Root cause confirmed in code (`button.tsx:59`). It is not specific to Move to.
2. **Line heights 2 to 4 px off: accepted for Gate 3 as Minor. See F-02.** Root cause is on the design side (the exported theme carries no line heights), so the fix starts with me, not the frontend.

## Findings

### F-01 · Important · Every paused button (all screens, 390 and 1280)
- **Owner:** bl-frontend. **File:** `src/components/ui/button.tsx` (line 59, with the `looks` and `pausedLook` objects at lines 17 to 25). **Evidence:** CODE, plus LANE `FE3-states/SCR-05--moving-desktop.png` (Saving card) and LOCAL `SCR-01--send-failed-mobile.png` ("Add a photo" at the 3-photo limit).
- **Expected:** a paused button keeps its designed height: 48 px primary, 44 px secondary (DESIGN.md `button-primary-disabled` 48 px; mockup `SCR-05--moving` panel C shows the paused Move to at 44 px with a dashed border). Design-specs "Saving is always: the button says Saving, is paused" and "Loading keeps layout stable".
- **Actual:** the `min-h-12` and `min-h-11` classes live inside `looks[variant]`, and a paused button swaps that whole object for `pausedLook`, which has no height. The button shrinks to its content: 17 px text at line height 1.25 plus 2 px border, about 23 px. On the Pipeline card the Saving Move to button measures about 22 to 26 px against 44 in the mockup, and the card below it jumps up.
- **Reach:** every `paused` use, 18 call sites: Send request while "Sending" (SCR-01, drops from 48 px), Save price and note while "Saving" (SCR-06), Sign in while pending (SCR-03), Move to while saving (SCR-04, SCR-05), Retry copy while retrying, Add a photo at the limit, Previous photo on photo 1 and Next photo on the last (SCR-08, which also misaligns the two buttons at the bottom), the Try again buttons while refetching, Show more while loading.
- **Rule:** design-specs "Targets: 44 px for primary touch actions, never under 24 px" (WCAG 2.2 2.5.8; a paused control is arguably exempt, but the press-time layout jump is not). State matrix Loading rule: skeletons and reserved space so nothing jumps.
- **Fix directive (bl-frontend):** make height independent of the paused flag. Move the heights out of `looks`, for example `const minHeight = { primary: 'min-h-12', secondary: 'min-h-11' }`, and apply `minHeight[variant]` in `cn(...)` for both paused and normal. Keep `pausedLook` for border, colour and cursor only. A paused primary stays 48 px, a paused secondary 44 px. Add one unit test that renders each variant with `paused` and asserts the class is present (or, in e2e, that a paused Move to measures at least 44 px). Re-run the FE3 Saving capture to confirm.

### F-02 · Minor · All screens: line heights differ from the mockups by about 1 to 7 px per block
- **Owner:** first bl-designer (the generated theme), then bl-frontend. **Files:** `scripts/export-brand.mjs` (emits no line heights), `src/app/theme.css` and `docs/tokens.json` (generated); then `src/components/ui/typography.ts` and `src/components/staff/week-count.tsx:21`. **Evidence:** CODE and LOCAL/LIVE screenshots against the mockups.
- **Expected:** each type style's `lineHeight` from DESIGN.md: h1 1.15, h2 1.2, body 1.55, ref 1.2, display 1.05.
- **Actual:** theme.css has `--text-*` sizes but no `--text-*--line-height`, so `typography.ts` substitutes Tailwind's nearest (`leading-tight` 1.25, body inherits 1.5, `leading-none` on the weekly numbers). Computed per line: h1 34 px is 42.5 against 39.1 (+3.4); h2 25 px +1.25; ref 19 px +1; body 17 px -0.85 per line (about -4 over a five-line paragraph); weekly number 44 px is 44 against 46.2 (-2.2); the 44 px display job tag +6.6 at 640 px and up. Observed: the SCR-02 mobile job tag is 74 px against 69 px in the mockup, and SCR-01 headings sit 3 to 4 px lower from the first heading on.
- **Ruling:** Minor, accepted for Gate 3. Nothing is clipped or misaligned, and the looser lines are readable. It is a build-from-contract drift, so fix it at the source rather than patching each component.
- **Fix directive:** bl-designer extends `scripts/export-brand.mjs` to write `--text-<style>--line-height: <value>` for every typography entry that has a `lineHeight` (Tailwind v4 then applies it with `text-h1` and so on), regenerates `src/app/theme.css` and `docs/tokens.json`, and `check-design` stays green. Then bl-frontend deletes the `leading-*` classes from `type.*` and `week-count.tsx` so the tokens win, and re-runs verify-ui.

### F-03 · Minor · SCR-04 rows and SCR-05 cards: the reference tag does not look like a link
- **Owner:** bl-frontend. **Files:** `src/components/staff/pipeline/board-card.tsx:53`, `src/components/staff/request-row.tsx`, `src/components/request/job-tag.tsx:19-23`. **Evidence:** LANE `FE2-states/SCR-04--menu-desktop.png` and `FE3/SCR-05-desktop.png` against `docs/design/screens/SCR-04-desktop.png` and `SCR-05-desktop.png`.
- **Expected:** reference tag underlined like the name (mockups draw both as links to SCR-06).
- **Actual:** the Link has `underline`, but the quiet tag is `inline-flex`, so the underline does not reach its text. The reference has no link affordance; the name beside it does.
- **Rule:** design-specs SCR-04 Behaviour "the reference and the name are both links"; DESIGN.md Components, links are underlined.
- **Fix direction:** apply the underline on the tag's own span in the quiet variant (for example an `underline underline-offset-4` prop on `JobTag`), keep the focus ring on the Link.

### F-04 · Minor · SCR-04, SCR-05: the Move to menu is plainer and wider than drawn
- **Owner:** bl-frontend. **File:** `src/components/staff/move-to-menu.tsx:112-143`. **Evidence:** LANE `FE2-states/SCR-04--menu-desktop.png` against `docs/design/screens/SCR-05--moving-desktop.png` (panel A).
- **Expected:** menu aligned to the button, a "MOVE NQ-7K3M9P TO" heading, each status with its icon.
- **Actual:** on a desktop row the menu runs about 22 px past the button's right edge and past the table border (x 1030 to 1190 against a button ending at 1167); items are words only, no heading.
- **Rule:** layout alignment; DESIGN.md "status as icon plus word". The menu items are words only, which is still not colour alone, so this is polish.
- **Fix direction:** anchor the list to the button's width (`left-0 right-0` on a wrapper that is the button's size, or `min-w-full w-max`), add the status icons and the heading from the mockup.

### F-05 · Minor · SCR-06 (390): the photo tile label wraps
- **Owner:** bl-frontend. **File:** `src/components/staff/photo-gallery.tsx:131-136`. **Evidence:** LIVE `FE2/390/SCR-06-unticked.png`, where each tile reads "View photo" over "1", against the one-line label in `docs/design/screens/SCR-06-mobile.png`.
- **Fix direction:** `whitespace-nowrap` and `px-xs` on the overlay label so "View photo 1" stays on one line in a 3-column grid at 390 px. The accessible name ("View photo 1 of 3 at full size") is already right.

### F-06 · Minor · SCR-06: small alignment differences
- **Owner:** bl-frontend. **Files:** `src/components/staff/quote-form.tsx` (note hint), `src/components/staff/request-detail.tsx`. **Evidence:** LIVE `FE2/390/SCR-06-ticked.png`, `FE2/1280/SCR-06-ticked.png` against the mockups.
- **Actual:** "Up to 1,000 characters." sits left under the note field; the mockup right-aligns it (with the live count, "38 of 1,000 characters" once typing). The stage tag and copy rows are otherwise identical.
- **Fix direction:** right-align the hint to match the mockup, or tell me the left alignment is preferred and I will update the mockup.

### F-07 · Minor (design doc, no code change) · Weekly count figures: spec text and DESIGN.md disagree
- **Owner:** bl-designer (documentation). **File:** `docs/design-specs.md` SCR-07 Layout says number 40 px and label 14 px; DESIGN.md says display 44 px and label-sm 15 px, and the build (`week-count.tsx`) follows DESIGN.md.
- **Ruling:** the build is right (DESIGN.md is the contract, and 15 px is the stated minimum for meta text). Update the SCR-07 layout line and the mockup in the next design pass; no frontend change.

### F-08 · Minor · A few off-scale spacing utilities
- **Owner:** bl-frontend. **Files:** `src/components/request/offers-checkbox.tsx:14,28` (`mt-0.5`, `pt-0.5`, 2 px), `src/components/request/job-tag.tsx:40` (`-mt-6 -mr-6 h-17.5 w-16`, the elbow), `src/components/staff/staff-shell.tsx:49` (`'4rem'` scroll padding in script), `src/components/staff/staff-page.tsx:17` (`max-w-320`, `max-w-280`).
- **Actual:** none is a raw hex or an arbitrary value, so the token rule holds. They are numeric steps outside DESIGN.md's 4, 8, 16, 24, 32, 48 scale or declared Layout constants (the elbow geometry, the 64 px bar, the 1120 and 1280 measures).
- **Fix direction:** name the 64 px bar and the elbow size as constants next to where they are used (or ask me to add them to DESIGN.md Layout), and replace the 2 px nudges with `xs`. Low value; do it with the F-02 pass.

## Accessibility scan

- **LOCAL (axe, WCAG 2.0 A/AA, 2.1 AA, 2.2 AA, phone width):** 0 violations on SCR-01, SCR-01--errors, SCR-01--send-failed, SCR-02, SCR-03, SCR-03--error. The page title, one h1, landmarks, labels and the error summary all pass.
- **LIVE (QA's sidecars, WCAG 2.1 A/AA):** 0 serious or critical, 0 minor or moderate, 0 console errors, 0 failed requests on SCR-03, SCR-04, SCR-06, SCR-07 and SCR-08 at 390 and 1280.
- **By hand (screenshots and code):** every status has an icon and a word; icon-only controls have names (the wordmark link is "Northside Plumbing, Hamilton", the label-in-name fixes from BUG-QA1-5 are in); focus ring tokens present on all controls, Paper on the teal bar; phone tab bar is fixed with `max-sm:pb-16` and `scroll-padding-bottom: 4rem`, so a focused control is not hidden behind it; body text is 17 px, hints 15 px (the one documented exception). The wordmark text is real Barlow, not a fallback.
- **Open:** F-01 (target size and layout jump while paused). Nothing else blocks use.

## Notes for Gate 3 (not defects)

- Full-page screenshots of SCR-06 and SCR-08 show the fixed bottom tab bar and the dialog mid-page. That is how a full-page capture draws viewport-fixed elements, not a layout bug. Judge the real viewport.
- Real photo thumbnails with an overlaid label (SCR-06) are better than the mockup's stand-in icon tiles; recommend updating the SCR-06 mockup when F-05 is done.

## Routing summary

| ID | Severity | Owner | Action |
|---|---|---|---|
| F-01 | Important | bl-frontend | Keep min-height on paused buttons (`button.tsx`), add a test, re-run FE3 Saving capture. Blocks approval. |
| F-02 | Minor | bl-designer then bl-frontend | Export line-height tokens, regenerate theme, remove `leading-*`. |
| F-03 | Minor | bl-frontend | Underline the reference tag. |
| F-04 | Minor | bl-frontend | Menu width, icons, heading. |
| F-05 | Minor | bl-frontend | Keep the photo label on one line at 390. |
| F-06 | Minor | bl-frontend | Right-align the note hint (or I update the mockup). |
| F-07 | Minor | bl-designer | Fix the SCR-07 text in design-specs and the mockup. |
| F-08 | Minor | bl-frontend | Name the off-scale constants. |

**To flip to APPROVED:** F-01 fixed and re-captured; Matthew or devops puts `VERCEL_AUTOMATION_BYPASS_SECRET` in my shell (or QA adds SCR-05 and SCR-04 at a viewport-sized capture) so the evidence gaps above are closed on staging. Minor findings go to Gate 3 as a list.

---

# Re-review at 42208a4

**Verdict: APPROVED.** 0 Critical, 0 Important open. F-01 (the only Important) is closed on staging, F-05 is closed, and the screens I could not see before (SCR-05, SCR-08 at 1280, SCR-01, SCR-02) match the design with no regression. Seven Minor items remain (F-02, F-03, F-04, F-06, F-07, F-08, plus BUG-FE2V-2 ruled Minor below) and go to Gate 3 as a list.

**Staging URL:** https://northside-quotes-git-staging-baseleap.vercel.app
**Commit under review:** `42208a4` (full hash `42208a49aaaf21477fd369360f6a17caed80254f`, read by QA from `/api/health` and saved in `docs/qa-reports/visual/FE2/deployment.json`; every DV1 capture JSON carries `commit_prefix: 42208a4`)
**Reviewer:** bl-designer · **Step:** DV1 (re-review) · **Date:** 2026-11-24
**Evidence:** QA's captures of the real staging preview, signed in with QA's saved session: `docs/qa-reports/visual/DV1/*` (SCR-01, 02, 04, 05, 08 and the Saving state) and `docs/qa-reports/visual/FE2/{390,1280}/*` (SCR-03, 04, 06, 07, 08), plus QA's "Re-run at 42208a4" in `.baseleap/reports/FE2V.md`. I did not sign in, did not send any password, and did not capture staging myself. Compared against `docs/design/screens/SCR-0N-{mobile,desktop}.png`. Every screenshot named below was opened.

## 1. Status of the first-review findings

| ID | First ruling | Now | Evidence |
|---|---|---|---|
| **F-01** paused buttons collapse to about 23 px | Important | **CLOSED** | LIVE: `DV1/SCR-05-move-to-saving-1280x800.json` measures the Saving Move to at **44 px** high (CSS `min-height` 44 px, `height` 44 px, 234 px wide, same as normal), `border_style: dashed`, `aria-disabled: "true"`. The card crop `…-card.png` shows the dashed Move to button at full height and the card not jumping, as in mockup panel C. SCR-08 Previous photo and Next photo (also paused-capable buttons) measure 44 px and sit level (`SCR-08-photo-viewer-1280x720.json`). CODE: `northside-quotes-wt-frontend/src/components/ui/button.tsx` now has `minHeight = { primary: 'min-h-12', secondary: 'min-h-11' }` applied outside the paused switch (line 65) and `pausedLook` is border, colour and cursor only, which is the fix I directed. Only the Move to button was measured while paused on staging; Send request "Sending", Sign in pending, Save price "Saving" and the others are covered by the same single component (code), not by their own staging capture: unverified individually. |
| **F-05** "View photo N" chip wraps at 390 | Minor | **CLOSED** | LIVE `FE2/390/SCR-06-unticked.png` (a request with 3 photos): each tile reads "View photo 1", "View photo 2", "View photo 3" on one line, inside its tile. |
| F-02 line heights 1 to 7 px off | Minor | **Still open (Minor, Gate 3)** | `src/app/theme.css` still has no `line-height` tokens (0 matches). Visible only as the known drift: SCR-02 display job tag 87 px high at 1280 against 80 px in the mockup, and SCR-01 headings a few px lower. Nothing clipped or misaligned. Fix starts with the designer (export script), as ruled. |
| F-03 reference tag not underlined | Minor | **Still open, and now seen on SCR-05 too** | LIVE `DV1/SCR-04-requests-1280x800.png`: names underlined, the "NQ-…" tags not. LIVE `DV1/SCR-05-pipeline-1280x800.png` and the 390 capture: the same on every card, where the mockup underlines both. Not a regression (same root cause as before, same component). |
| F-04 Move to menu plainer and wider than drawn | Minor | **Unchanged, not re-verified** | No QA capture opens the menu on staging. Status from the first review stands (LANE screenshots only). |
| F-06 note hint left-aligned | Minor | **Still open** | LIVE `FE2/390/SCR-06-unticked.png`: "Up to 1,000 characters." is left under the note field; the mockup right-aligns it. |
| F-07 SCR-07 spec text disagrees with DESIGN.md | Minor (doc) | **Still open, mine** | Design-doc fix (design-specs SCR-07 layout line and the mockup, 44 px number and 15 px label). No code change. The build is right. SCR-07 on staging again shows the 44 px figures (`FE2/1280/SCR-07-weekly-strip.png`, and the strip at the top of SCR-04 and SCR-05). |
| F-08 off-scale spacing utilities | Minor | **Unchanged, not re-checked** | I did not re-scan the frontend diff in this pass. No raw hex or arbitrary values were found in the first review; nothing in the new captures suggests otherwise. |

## 2. Screens I could not see before

All four are reviewed from QA's staging captures at 42208a4. Axe on every one of them: 0 serious or critical, 0 minor or moderate, 0 console errors, 0 failed requests, no sideways scroll (read from each sidecar JSON).

### SCR-05 Pipeline (390 and 1280, viewport-sized): matches, no finding
- **1280:** teal top bar with Requests and Pipeline as two tabs, Pipeline underlined; page title; weekly strip (79, 10, 1) with Won and Lost icons plus words; the instruction line verbatim from the spec; four Fog columns (New, Quoted, Won, Lost), each with its icon and word; cards with the job tag, name, urgency badge with icon and word, time, drag handle, and a full-width Move to button at 44 px. Same hierarchy, order and grouping as `SCR-05-desktop.png`. No List / Board switch.
- **390:** one column; strip as three tiles with the date beside "THIS WEEK" on one row; the New / Quoted / Won / Lost jump control; column cards stacked; fixed bottom tab bar with Pipeline marked (Fog fill, teal top rule). Same as `SCR-05-mobile.png`. The phone card name and Move to button are full width.
- **Allowed differences:** real QA test names (long, they wrap to two lines), 79 requests this week, and the page height (11,658 px at 1280, 14,729 px at 390) because each column lists up to 50 cards, as designed (AC-016.x "50 and Show more").
- **Not seen:** an Emergency card (copper bar and icon) on the Pipeline, and the "Show more" button at the foot of a long column. The seeded data in these captures has no Emergency card on the board. Both were verified on the earlier SCR-04 and LANE evidence only. Unverified on staging; not a blocker.

### SCR-08 Photo viewer at 1280 (800 and 720 high): matches, F-overlap resolved
- At 1280 x 800 the photo is 858 x 643 (4:3) at y 81 to 724, Previous photo and Next photo at y 740 with a 16 px gap, level and 44 px high. At 1280 x 720 the photo is 751 x 563, buttons at y 660, 16 px gap, `covered: []`, no dialog scroll. Close sits top right at 44 px. "Photo 2 of 3" title and the reference and name line are present. Matches the mockup structure. The earlier overlap QA found is gone. At 390 (FE2): photo full width, Close top right, Previous and Next level at the bottom, nothing overlapping.

### SCR-01 Request form (390 and 1280): matches, no finding
- **1280 full page** (`SCR-01-request-form-1280x800-full.png`): Paper card on Fog, teal bar with the wordmark, "Request a quote" h1, six labelled fields with a visible label above each, hint "Northside may call or text this number.", three urgency radio cards with icon-less circles plus word and sentence, "Photos (optional)" with the Add a photo button, the **offers checkbox unticked** on its own Fog strip with the label "Email me offers and news from Northside. This is optional.", the plain-language data line beneath it, and a full-width teal "Send request" at 48 px. Footer with "Staff sign-in". Same as `SCR-01-desktop.png`. A filled capture (name, phone, email, address, problem, "Soon" selected, two photos with Remove) also matches.
- **390** viewport shot: header, h1, intro, "All six questions are required. Photos are optional.", then the first fields at 17 px body. Single column, labels above fields, no sideways scroll (`document_scroll_width` 390). I read the first screenful only at 390 (the full-page 390 capture was not needed for a layout difference; the 1280 full page shows the whole form).

### SCR-02 Confirmation (390 and 1280): matches, no finding
- **1280:** "Request sent" with the success icon, h1 "Thanks, Dana. Northside has your request.", "YOUR REFERENCE NUMBER", the display job tag hung from the copper elbow, a teal "Copy reference number" button, "What happens next" with the two paragraphs including "No email or text is sent to you now…", the Fog "WHAT YOU SENT" summary (phone, address, urgency badge with icon and word, photos "1 attached"), and a quiet "Send another request" secondary button. Same order and grouping as `SCR-02-desktop.png`. The tag is about 7 px taller than the mockup (F-02).
- **390:** the narrowed-desktop capture, as QA noted (no touch, 1x, a 390 px desktop window, not an emulated phone). It shows one column, the tag and elbow intact, the copy button, the summary card and the secondary button; `document_scroll_width` 390, no sideways scroll. It proves the layout at 390 px width; it does **not** prove phone touch behaviour or phone font rendering. Treat the phone confirmation as seen at width only.

## 3. Ruling on BUG-FE2V-2 (Move to accessible name does not gain ", saving")

**Ruling: Minor. Not acceptable to leave undocumented, but it does not block approval.** Fix it in the next frontend pass, or drop the clause from design-specs. I recommend fixing it.

- **Evidence:** `DV1/SCR-05-move-to-saving-1280x800.json`: `move_to_saving_accessible_name` is "Move to another status, NQ-GBG78M", `accessible_name_says_saving` false, `aria_disabled` "true". `docs/design-specs.md` line 174 (MoveToMenu): the name becomes "Move to another status, NQ-7K3M9P, saving" while it saves.
- **Why it is not Important:** the control is exposed as unavailable (`aria-disabled="true"`, so a screen reader announces it as dimmed or unavailable), the card shows the visible word "Saving", and the result is announced afterwards ("NQ-… moved to Quoted", or the failure message). Name, role and state are all programmatically available (WCAG 4.1.2), so there is no AA failure. The visible label still starts the name, so label-in-name (2.5.3) holds. The state lasts about a second.
- **Why it is still a Minor:** a screen-reader user who lands on the dimmed button gets no reason for it, and a documented spec line is not met. A written requirement that the build skips quietly is the kind of drift this review exists to report.
- **Unverified:** whether the card's "Saving" text is exposed to assistive tech as a status. I only had the button's name and attributes. If it is not announced, that raises this from nice-to-have to worth doing first among the Minors.
- **Fix direction (bl-frontend):** while saving, build the accessible name as `Move to another status, <ref>, saving` (visible "Move to" still first), and tell QA to turn `accessible_name_says_saving` into an assertion. Do not change the visible label. The alternative, editing the design-specs line to match the build, is acceptable only if the card's "Saving" is announced as a status; say so, and I will update the spec.

## 4. Regressions and new findings

None. Every screen compared at 42208a4 keeps the brand fidelity, token use, two-tab navigation, unticked offers box and "Not copied: no offers consent" label confirmed in the first review (`FE2/*/SCR-06-unticked.png` retaken at 42208a4 and unchanged). I raised no new nitpicks on screens I had already reviewed.

## 5. Still unverified (not blocking)

- Emergency card and "Show more" on the Pipeline on staging; the Move to menu on staging (F-04).
- Other paused buttons measured on staging (Sending, Sign in pending, Saving a price): same component, not individually captured.
- Keyboard walk-through, visible focus rings and reduced-motion behaviour by hand; QA says it did not assess focus rings in this run. Reviewed from code and QA's focus-trap tests only, as before.
- Phone touch and font rendering on SCR-02 (the 390 capture is a narrow desktop window).
- Axe at WCAG 2.2 tags on staff screens (QA scans use 2.1 tags). With F-01 closed, I know of no target-size problem left.

## 6. Routing summary (Gate 3 list)

| ID | Severity | Owner | Action |
|---|---|---|---|
| F-02 | Minor | bl-designer then bl-frontend | Export line-height tokens, regenerate theme, remove `leading-*`. |
| F-03 | Minor | bl-frontend | Underline the reference tag on SCR-04 rows and SCR-05 cards. |
| F-04 | Minor | bl-frontend | Menu width, icons, heading (needs a staging capture to re-verify). |
| F-06 | Minor | bl-frontend | Right-align the note hint, or tell me and I update the mockup. |
| F-07 | Minor | bl-designer | Fix the SCR-07 text in design-specs and the mockup. |
| F-08 | Minor | bl-frontend | Name the off-scale constants. |
| BUG-FE2V-2 | Minor | bl-frontend | Add ", saving" to the Move to accessible name while saving; QA asserts it. |
| F-01, F-05 | closed | none | none |

Also recommended for the design pass: update the SCR-06 mockup to show real photo thumbnails with the one-line overlay label, since the build is better than the stand-in tiles.
