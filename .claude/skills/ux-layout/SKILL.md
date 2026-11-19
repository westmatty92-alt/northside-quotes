---
name: ux-layout
description: Screen layout for bl-designer — compose each inventoried screen with clear hierarchy, one focal point and deliberate spacing, using only DESIGN.md tokens, as an HTML mockup the frontend can read directly. Use after flows, for every screen in the inventory.
---

# Designer · Screen Layout

Each screen gets a mockup that looks like the real product — real copy, real-shaped data, the client's brand — built only from `DESIGN.md` tokens. The frontend builds from it; Matthew approves from its screenshots.

## 1. Mockup files

- One file per screen: `design/mockups/SCR-NN-<slug>.html` (template: `templates/mockup.html`).
- Styles come **only** from the exported theme (`src/app/theme.css`, generated from `DESIGN.md`) plus layout utilities. **No raw hex, no font not in DESIGN.md, no inline magic numbers** — the checker scans for them.
- Realistic content: names, dates, amounts and counts that look like the client's real data (from the PRD and research). No lorem ipsum, no "John Doe", no fake-precise stats.
- Plain, self-contained HTML + CSS — no framework, no build step, no network requests. It's a picture of the screen, not the implementation.

## 2. Hierarchy

For each screen, decide before drawing:
- **The one thing** the user came here to do → the focal point and the only primary button.
- **Reading order** — what's seen first, second, third; size, weight and position follow that order.
- **Grouping** — related items close together, unrelated items separated (proximity beats borders and boxes).
- **Density** — match the use: operator dashboards can be dense; customer-facing flows breathe.

## 3. Layout craft

- Spacing only from the `spacing` scale; consistent rhythm across screens.
- Align to a grid; ragged alignment reads as broken.
- Use layout variety on long pages (not the same card row repeated); avoid nested cards.
- Numbers right-aligned in tables; units and currency formatted the way the client's customers expect (CAD, local date formats).
- Copy is part of the design: button labels say what happens ("Book 10:00"), not "Submit"; error messages say what to do next.

## 4. Screenshots (the review medium)

Every mockup is rendered by `scripts/render-mockups.mjs` (Playwright) at three widths into `docs/design/screens/`:
- `SCR-NN-mobile.png` (390 px), `SCR-NN-desktop.png` (1280 px), and `SCR-NN-embed.png` (the GHL container width from `ux-a11y` §4) for embed screens.

**Look at your own screenshots** (Read the PNGs) and fix what you see before reporting — overflow, cramped spacing, weak hierarchy, unreadable contrast. The images are what Matthew sees at Gate 2.

## 5. Optional: push to Figma

When Matthew wants to edit a design visually and the Figma MCP is connected, the rendered mockups can be pushed to a Figma file as editable frames (remote server's write-to-canvas). Figma is then a review copy — **`DESIGN.md` and the mockups in the repo stay the source of truth**; edits made in Figma come back as a change request, not a silent override.

---
Sources (ideas adapted, text written for Baseleap): buildgreatproducts/builder-os `design-better` (MIT — hierarchy, layout, typography and state heuristics), owl-listener/designer-skills `critique-visual-hierarchy`, `critique-composition`, `critique-information-density` (MIT), anthropics/skills `frontend-design` (Apache-2.0 — commit to a direction, no generic defaults). figma/mcp-server-guide reviewed for the write-to-canvas workflow (no licence file — not vendored).
