---
name: ux-a11y
description: Accessibility, responsive behaviour and GHL embedding for bl-designer — WCAG 2.2 AA by design (contrast, focus, keyboard, targets, motion, screen readers), mobile-first breakpoints, and the layout rules for modules that live inside a GHL iframe. Use while laying out screens and again as a check before handoff.
---

# Designer · Accessibility, Responsive & GHL Embed

Accessibility designed in is nearly free; retrofitted, it's a rebuild. Same for mobile, and for screens the PRD places inside a GHL marketing page.

## 1. WCAG 2.2 AA — designed, not audited later

| Area | Requirement |
|---|---|
| Contrast | text 4.5:1, large text and UI parts (borders, icons, focus rings) 3:1 — the DESIGN.md linter checks token pairs; you check any pairing it can't see (text on images, disabled states) |
| Colour | never the only signal — status badges have text, errors have an icon and a message, charts have labels or patterns |
| Focus | a visible focus style from `DESIGN.md` (`focus` token) on every interactive element; never removed |
| Keyboard | every task completable by keyboard; document the path for custom widgets (e.g. SlotGrid: arrows move, Enter selects, Esc closes) |
| Targets | at least 24×24 px (WCAG 2.2 AA); 44×44 px for primary touch actions |
| Motion | `prefers-reduced-motion` respected; nothing flashes |
| Text | resizable to 200% without loss; line length ~45–75 characters for reading text |
| Screen readers | headings in order (one `h1` per screen), landmarks, labels on icon-only buttons, live-region announcements for async results ("Booking confirmed") — specify them in the component map notes |
| Forms | programmatic labels, errors linked to fields, no time limits without a way to extend |

## 2. Responsive

- **Mobile first**: design the 390 px layout, then expand. Most of a local business's customers are on phones.
- Breakpoints from `DESIGN.md` (default: 640 / 1024 / 1280). Say what changes at each — columns, navigation pattern, table → card list.
- Tables with many columns become stacked cards on mobile; never horizontal scroll for primary content.
- Touch: no hover-only actions; spacing between adjacent targets.

## 3. Content & language

- Plain language, the client's customers' words. Dates, times and currency in the client's locale (Ontario: `en-CA`, CAD, 12-hour times unless the client says otherwise).
- Room for longer text (French Canadian strings run ~20–30% longer) when the PRD mentions bilingual.

## 4. GHL iframe embedding

Only screens the PRD places on a GHL marketing page (access = `embed` in `user-flows.md`) are embedded; the CRM itself is a standalone app. For embed screens:
- **No app chrome** — no global nav, sidebar or footer; one focused task.
- **Width:** design for the GHL container it sits in — default 800 px, and down to 360 px on mobile GHL pages. Confirm the real width from the client's GHL page when available.
- **Height:** content-driven; avoid fixed full-viewport layouts and inner scroll regions (the iframe may auto-resize or may not — the architect decides; design so both work).
- **Visual fit:** the module should look at home on the client's GHL page — background, radius and type follow `DESIGN.md`, which matches the client's brand.
- **No top-level navigation** from inside the frame (no full-page redirects); external links open in a new tab.
- Sign-in inside the frame is designed only as the architect's embed decision specifies (`docs/SECURITY_MODEL.md`).

## 5. Pre-handoff accessibility pass

Go through §1 for every screen's mockup and screenshot. Record any intentional exception with its reason in the design spec — there should be very few.

---
Sources (ideas adapted, text written for Baseleap): owl-listener/designer-skills `accessibility-audit`, `localization-design`, `fitts-law` (MIT — WCAG 2.2 POUR, severity), buildgreatproducts/builder-os `design-better` (MIT — WCAG 2.2 AA and mobile/touch heuristics), google-labs-code/design.md (Apache-2.0 — contrast linting). Baseleap rule: every client-facing module embeds in GHL.
