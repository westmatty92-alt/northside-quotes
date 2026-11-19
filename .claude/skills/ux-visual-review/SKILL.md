---
name: ux-visual-review
description: Post-build visual review for bl-designer — screenshot the staging preview at the design widths, compare each screen against its mockup and DESIGN.md, run an automated accessibility scan, check the code uses tokens not raw values, and file severity-tagged findings. Never edits code. Use in Phase 3/4 when the orchestrator dispatches a design-review step.
---

# Designer · Post-Build Visual Review

You designed it; now check what was built matches. You're a critic in this step — you file findings, the frontend fixes them. Review the live preview, not the frontend's description of it.

## 1. Inputs (from the brief)

The staging preview URL, the screen inventory (`docs/user-flows.md`), the mockups and screenshots you produced, `DESIGN.md`, and the diff range for the frontend's files. Not the frontend's report.

## 2. Capture

`node scripts/render-preview.mjs <preview-url> SCR-01=/route SCR-02=/other …` (the brief gives each screen's route). It writes `docs/design/review/SCR-NN-{mobile,desktop,embed}.png` at the same widths as your mockup screenshots, plus `SCR-NN-axe.json` (accessibility scan and console errors) for every screen. Screens needing data use the seed or test account named in the brief — never a real customer's account.

## 3. Compare, screen by screen

Read your mockup screenshot and the live screenshot side by side. Check:
- **Hierarchy & layout** — same focal point, same reading order, same grouping; nothing missing, nothing added that wasn't designed.
- **Tokens** — colours, type, spacing and radius look like DESIGN.md; then confirm in code: no raw hex/rgb or arbitrary Tailwind values (`text-[#…]`, `p-[13px]`) in the frontend's diff.
- **States** — load each screen's empty, loading (throttled), error (fault-injected or mocked) and success states where reachable; compare to the state matrix.
- **Responsive** — mobile layout is the designed one (not a squeezed desktop); embed screens have no app chrome and fit the container width.
- **Copy** — button labels, empty-state and error text match the design spec.

Allowed differences: real data lengths, browser font rendering, and anything the frontend raised as a contract question that was approved.

## 4. Accessibility scan

`render-preview` already ran axe-core on every screen. Read each `SCR-NN-axe.json` and record the violations. Then check by hand what automation misses: keyboard path through each custom widget, visible focus, reduced-motion behaviour, screen-reader names on icon buttons.

## 5. Findings

Write `.baseleap/reviews/<STEP>.md`. One finding per issue:

```markdown
### F-03 · Important · SCR-02 Slot picker (mobile)
Expected: primary "Book" button full-width, pinned above the fold (mockup SCR-02-mobile.png)
Actual: button below 6 slot rows, off-screen at 390 px (review/SCR-02-mobile.png)
Rule: one primary action visible per view (design-specs SCR-02 layout notes)
Fix direction: move the action into a sticky footer on < 640 px
```

Severity: **Critical** (a flow can't be completed, an AA failure that blocks use, wrong data shown) · **Important** (visible deviation from the design or the state matrix, AA failures, broken mobile layout) · **Minor** (polish — spacing off by a step, small alignment). Critical and Important go back to the frontend through the orchestrator's fix loop, then re-QA; Minor findings are listed for Gate 3.

## 6. Rules

- Never edit code, tests or the design to make them match — file the finding.
- If the build is *better* than the mockup for a real reason, say so and recommend updating the design spec — don't silently accept drift.
- Everything verifiable: each finding cites both screenshots (or the code line) and the rule it breaks.

---
Sources (ideas adapted, text written for Baseleap): Matthew's designer blueprint (post-build Playwright review), rknall/claude-skills `ui-design-review` and accesslint/claude-marketplace `accessibility-audit`/`accessibility-scan` (no licence — ideas only: review areas, priority classes, automated + manual a11y), vercel-labs/agent-skills `web-design-guidelines` (no licence — ideas only; its live-fetched rule list is deliberately not used, since rules fetched at run time could change agent behaviour mid-build), owl-listener/designer-skills `design-qa-checklist` (MIT).
