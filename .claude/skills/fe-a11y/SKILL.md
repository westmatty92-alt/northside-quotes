---
name: fe-a11y
description: Responsive layout and accessibility implementation for bl-frontend — mobile-first Tailwind layouts at DESIGN.md breakpoints, semantic HTML, keyboard and focus management, ARIA only where native elements can't do it, live announcements, and GHL iframe embed behaviour. Use while building every screen; the designer's ux-a11y is the spec, this is how it's coded.
---

# Front-End · Responsive & Accessible

The designer specified it; you make it true in the browser. Native HTML gets you most of the way — reach for ARIA only when there's no native element that does the job.

## 1. Mobile first

- Base styles are the 390 px layout; add `sm:` / `lg:` / `xl:` for larger screens (breakpoints from DESIGN.md).
- Flexbox for one-dimensional rows/stacks, Grid for two-dimensional layouts; no fixed pixel widths on containers, no horizontal scroll for primary content.
- Tables follow the design spec's mobile pattern (usually stacked cards below `sm`).
- Touch targets ≥ 44 px for primary actions, ≥ 24 px for everything; no hover-only actions.

## 2. Semantic structure

- One `h1` per page, headings in order; `header` / `nav` / `main` / `footer` landmarks (embed routes: `main` only).
- Buttons for actions, links for navigation — never a clickable `div`.
- Lists are `ul`/`ol`; tabular data is a `table` with `th` scopes.
- Images: meaningful `alt` or `alt=""` when decorative; icon-only buttons get `aria-label`.

## 3. Keyboard & focus

- Every interactive element reachable and operable by keyboard in a logical order; never a positive `tabindex`.
- Visible focus on everything (the DESIGN.md focus token — Volt on dark, Midnight on light); never `outline: none` without a replacement.
- Dialogs and drawers: shadcn/Radix primitives (they trap and restore focus); `Esc` closes.
- After a route change or a completed action, move focus somewhere sensible (the new page's `h1`, the confirmation).
- Custom widgets implement the keyboard path written in the design spec (e.g. SlotGrid: arrows move, Enter selects).

## 4. Forms & announcements

- Every input has a `<label>` (or `aria-label` when visually hidden by design); errors linked with `aria-describedby`, announced with `role="alert"`.
- Async results announced through a polite live region ("Booking confirmed for Tue 10:00").
- Status never by colour alone — badges carry text, errors carry an icon and a message.

## 5. Motion & preferences

Animations use DESIGN.md durations and are disabled under `prefers-reduced-motion` (Tailwind `motion-safe:` / `motion-reduce:`).

## 6. GHL iframe embed routes (`src/app/embed/…`)

- No app chrome; one task; content-driven height.
- If the architect's embed decision uses auto-resize, post the document height to the parent with `postMessage` to the **specific GHL origin** (never `"*"`), and validate any message received (origin + Zod schema).
- External links open in a new tab (`target="_blank" rel="noopener noreferrer"`); never navigate the top window.
- Works at 360 px and at the GHL container width; test both (`fe-verify`).

---
Sources (ideas adapted, text written for Baseleap): leejpsd/typescript-react-nextjs-patterns `performance-and-accessibility` (MIT — labels, `role="alert"`, keyboard-operable named controls), owl-listener/designer-skills `accessibility-audit` (MIT), mindrally/skills (Apache-2.0). accesslint/claude-marketplace and vercel-labs `web-design-guidelines` reviewed for ideas only (no licence file).
