---
name: ux-handoff
description: Design handoff for bl-designer — assemble docs/design-specs.md, render and self-review the mockup screenshots, run the pre-flight gate and scored self-critique, and write the report the orchestrator turns into the design part of the Gate 2 packet. Use as the last thing before reporting.
---

# Designer · Handoff

Your output is read by the architect (data needs), the frontend (exactly what to build), QA (states to test) and Matthew (screenshots at Gate 2). This pass makes sure each of them can act without asking you.

## 1. Assemble `docs/design-specs.md`

From `templates/design-specs.md`. Sections: Brand reference (link to DESIGN.md, signature element) · Screens (per screen: purpose, stories, mockup + screenshot links, layout notes, states) · Component map · State matrix · Responsive behaviour · GHL embed · Accessibility notes · Conversion path · Copy (key microcopy: buttons, empty states, errors) · Open questions. Inventory, navigation and flows are in `docs/user-flows.md` (`ux-flows`) — check the two files agree.

## 2. Render and look

1. `node scripts/render-mockups.mjs` → screenshots for every mockup at mobile / desktop / embed widths.
2. Read every screenshot. Fix and re-render until nothing's broken: overflow, clipping, cramped or inconsistent spacing, weak hierarchy, illegible text.

## 3. Pre-flight gate (count, don't eyeball)

- [ ] Off-DESIGN.md values in mockups: **0** (no raw hex, no undeclared font, no magic spacing)
- [ ] One accent, one radius scale, one icon family, one type pairing across all screens
- [ ] Every Must story → at least one screen; every screen → all states listed
- [ ] Every `[edge]` / `[error]` acceptance criterion → a designed state (AC IDs referenced)
- [ ] One primary action per view; primary nav ≤ 5
- [ ] Contrast passes (linter + manual check of pairings it can't see); focus visible; keyboard path documented for custom widgets; targets ≥ 24 px
- [ ] Mobile layout designed, not shrunk; embed screens have no app chrome
- [ ] No lorem ipsum, fake names or fake-precise numbers in visible copy
- [ ] Slop test and counterfactual test pass (`ux-brand` §4)
- [ ] Conversion-path screens: one obvious next step, anxiety answered at the action, no dark patterns (`ux-conversion`)
- [ ] `src/app/theme.css` and `docs/tokens.json` freshly exported from DESIGN.md (`node scripts/export-brand.mjs`)
- [ ] Every screenshot opened: every screen at both widths, every state at phone width

**Interaction and accessibility, in the mockups and the specs.** The developers build what you draw, so these have to be visible in the design, not left for later:
- [ ] **Focus:** a visible focus ring on every control, including inside dialogs, and never hidden behind a sticky header.
- [ ] **Forms:**
  - every field has a visible label (not placeholder-only);
  - each error is specific and sits under its field;
  - a failed submit shows an error summary at the top that links to each field;
  - typed values are kept.
- [ ] **Buttons that save:** they show a busy state and can't be pressed twice; then success or a clear failure.
- [ ] **Irreversible actions** (delete, cancel, remove access): a confirmation that names what happens. **Destructive actions are never the default button.**
- [ ] **Status:** never colour alone. Always a word and an icon or shape.
- [ ] **Icon-only buttons:** they have a text label in the specs (for screen readers).
- [ ] **Phones:**
  - nothing scrolls sideways;
  - long words, emails and addresses wrap;
  - body text is at least 16 px;
  - tap targets are 44 px (24 px minimum with spacing);
  - nothing important is hover-only.
- [ ] **Loading:** keeps the layout stable (skeletons or reserved space), so content doesn't jump when data arrives.
- [ ] **Motion:** at most one or two animated elements per view, and a still version for "reduce motion".
- [ ] **Sign-in:** works with password managers and paste. No puzzles or memory tests.
- [ ] **AI-generated content**, if any: labelled as such.

<!-- Distilled in our own words from the high-severity web rules in nextlevelbuilder/ui-ux-pro-max-skill (MIT, data/ux-guidelines.csv); source kept in research/designer/. -->

Any box you can't honestly tick → fix it, then re-run.

## 4. Scored self-critique

Score 0–4 each: distinctiveness · hierarchy & focus · consistency with DESIGN.md · accessibility · state coverage · copy quality · restraint · mobile. Most real work lands 2–3. **Any axis ≤ 2 → name the fix, apply it, re-score.** Record the final scores and what changed in your report. (This improves the work; it isn't the gate — the checker and Matthew are.)

## 5. Report

`stack-specialist-protocol` format, with this block on top for the orchestrator's Gate 2 packet:

```markdown
## Gate 2 design summary (≤ 8 lines)
- Brand: <DESIGN.md source — client kit / Baseleap / new> · signature: <one line>
- Screens: <N> (<N> embed) — key screenshots: docs/design/screens/SCR-01-mobile.png, …
- Flows: <N Must stories covered, edge paths included>
- Components: <N shadcn-based, N custom (names)>
- Accessibility: <AA — exceptions: none / list>
- Data needs flagged for the architect: <count; anything unusual>
- Decisions for Matthew: <open questions with recommendation>
```

Status values: **done** · **needs-answers** (no brand source, or a product question the PRD doesn't settle) · **blocked**.

---
Sources (ideas adapted, text written for Baseleap): owl-listener/designer-skills `design-qa-checklist`, `design-critique` (MIT), buildgreatproducts/builder-os `design-better` (MIT — "what done looks like"). ulpi-io/skills design pre-flight and scored self-critique reviewed for ideas only (no licence — checklist rewritten for Baseleap).
