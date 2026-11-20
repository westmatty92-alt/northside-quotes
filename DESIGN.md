---
version: alpha
name: Northside Plumbing (PROPOSAL)
description: Proposed brand contract for Northside quote requests. The client has no brand files, no website and no recorded brand source, so this is a plain trades look proposed by the designer for Matthew to confirm or replace. Navy ink and white for trust, one copper accent (the colour of the pipe) for the single main action, system fonts so the page loads fast on a phone.
colors:
  ink: "#14243A"
  slate: "#44546A"
  steel: "#66758A"
  line: "#C9D1DB"
  mist: "#F3F5F8"
  fog: "#E4E8EE"
  paper: "#FFFFFF"
  copper: "#A8430F"
  copper-deep: "#8A340A"
  green: "#1E6B3C"
  green-tint: "#E2F2E8"
  amber: "#7A4A00"
  amber-tint: "#FCF0D6"
  red: "#B3261E"
  red-tint: "#FBE6E4"
  blue-tint: "#DEE9F5"
  primary: "{colors.ink}"
  surface: "{colors.paper}"
  surface-raised: "{colors.mist}"
  surface-inverse: "{colors.ink}"
  neutral-surface: "{colors.fog}"
  text: "{colors.ink}"
  text-secondary: "{colors.slate}"
  text-inverse: "{colors.paper}"
  accent: "{colors.copper}"
  accent-hover: "{colors.copper-deep}"
  on-accent: "{colors.paper}"
  border: "{colors.line}"
  border-strong: "{colors.steel}"
  focus: "{colors.ink}"
  focus-on-dark: "{colors.paper}"
  success: "{colors.green}"
  success-surface: "{colors.green-tint}"
  warning: "{colors.amber}"
  warning-surface: "{colors.amber-tint}"
  danger: "{colors.red}"
  danger-surface: "{colors.red-tint}"
  info-surface: "{colors.blue-tint}"
typography:
  display:
    fontFamily: system-ui
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.1
  h1:
    fontFamily: system-ui
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
  h2:
    fontFamily: system-ui
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.3
  h3:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.35
  body-lg:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  ui-label:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
  label-sm:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.04em
  ref:
    fontFamily: ui-monospace
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0.06em
  ref-display:
    fontFamily: ui-monospace
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: 0.08em
rounded:
  sm: 4px
  md: 6px
  lg: 10px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  button-primary-disabled:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  input-error:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-board:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 12px
  board-column:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 12px
  nav-bar:
    backgroundColor: "{colors.surface-inverse}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.ui-label}"
    height: 56px
  job-tag:
    backgroundColor: "{colors.surface-inverse}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.ref}"
    rounded: "{rounded.sm}"
    padding: 8px
  job-tag-quiet:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ref}"
    rounded: "{rounded.sm}"
    padding: 4px
  segment:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.ui-label}"
    height: 44px
  segment-active:
    backgroundColor: "{colors.surface-inverse}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.ui-label}"
    height: 44px
  badge-new:
    backgroundColor: "{colors.info-surface}"
    textColor: "{colors.text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 4px
  badge-quoted:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 4px
  badge-won:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 4px
  badge-lost:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 4px
  urgency-emergency:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: 4px
  urgency-soon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: 4px
  urgency-flexible:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: 4px
  banner-error:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  banner-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  banner-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  banner-info:
    backgroundColor: "{colors.info-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  skeleton:
    backgroundColor: "{colors.neutral-surface}"
    rounded: "{rounded.sm}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.border-strong}"
    height: 1px
---

## Overview
**Status: PROPOSAL.** Northside Plumbing (TEST) has no logo, colours, brand guide or website, and the research record names no brand source (`brand_source` is empty). This file is the designer's proposal for a plain, trustworthy trades look, written so Matthew can confirm it or swap in a real brand later without touching any screen: every mockup and every line of frontend code uses only the tokens here. It is not a copy of an existing look, because there is none; no role below was taken from an existing screen.

The mood is sturdy, plain and calm: navy ink on white like a van door or an invoice, one copper accent like a copper pipe, square-ish corners, big touch targets. A homeowner with a wet cabinet should feel that someone competent will read this. The staff screens are the same look at higher density.

**Signature element: the job tag.** Plumbers hang a tag on a job. The reference number (`NQ-7K3M9P`) is always shown as a small tag: monospaced, tracked-out letters on an ink tag with a punched hole at one end (on the confirmation and the request detail) or a quiet mist tag (in rows and cards). It is the one object the homeowner keeps and the one the owner quotes back on the phone, so it is the one thing styled differently from everything else. There is no logo: the header carries the words "Northside Plumbing" set in the heading style, because no logo has been supplied and none is invented.

## Colors
Roles, not decoration:
- **Ink** (navy) is text, the staff header bar, the tag and the active tab. **Paper** (white) is the page. **Mist** is raised areas (board columns, field groups, count tiles). **Fog** is the quiet fill (skeletons, the Lost badge, disabled buttons).
- **Copper** is the one accent: the single primary action on a screen, links, and the selected-state underline. Copper-deep is its hover and pressed colour. White text on copper is 6.0:1.
- **Slate** is secondary text (7.7:1 on white, 7.0:1 on mist). **Line** is decorative dividers and card borders. **Steel** is the border of form fields and menus (4.7:1 on white; fields need 3:1).
- **Status colours are functional and never the only signal.** New = blue tint, Quoted = amber, Won = green, Lost = neutral grey; each badge carries an icon and the word. Emergency uses red with an alert icon and the word. Errors use a red tint panel with an icon and a sentence. Text inside tinted panels is ink, except badges, which use the dark partner colour on its own tint (all 5:1 or better).
- **Focus** is a 3 px ink ring with a 2 px gap on light surfaces (15:1 on white) and a paper ring on the ink header.

Accessible pairings (WCAG AA, computed): ink on paper 15.6:1 · ink on mist 14:1 · white on copper 6.0:1 · white on copper-deep 8.2:1 · slate on paper 7.7:1 · slate on fog 6.3:1 · green on green-tint 5.6:1 · amber on amber-tint 6.6:1 · red on red-tint 5.5:1 · red on paper 6.5:1 · ink on blue-tint 12.7:1 · copper on paper 6.0:1 (links).

## Typography
System fonts only (`system-ui`, `ui-monospace` for reference numbers). That is a decision, not a gap: nothing to download keeps the public form inside the 3-second 4G budget (FR-5), and it reads as native on every phone. Screenshots in the Gate 2 packet are drawn with the rendering machine's system font; a phone will show its own (San Francisco, Roboto). Hierarchy comes from size, weight and spacing: display 40 for the reference number figure and the weekly counts, h1 28, h2 22, h3 18, body 16 (never smaller for reading text), body-sm 14 only for meta (times, hints), label-sm 14 semibold with slight tracking for badges and column headers. Reference numbers use the monospace `ref` and `ref-display` styles so characters are never confused (the format already excludes I, L and O).

## Layout
8 px rhythm from the spacing scale (4, 8, 16, 24, 32, 48). Phone first at 390 px; breakpoints at 640, 1024 and 1280. Public pages: one column, 560 px maximum, generous spacing. Staff pages: content up to 1120 px; the board uses up to 1280 px. Declared constants used in mockups and code: touch target 44 px minimum and 48 px for primary actions and form fields; board column minimum width 240 px; hairline borders 1 px and focus ring 3 px. Staff screens are dense (`sm` and `md` cell padding); the public form and the confirmation breathe (`lg`).

## Elevation & Depth
Flat. No shadows. A raised area is mist on white; a card is white with a 1 px line border; the open "Move to" menu is white with a 1 px steel border; a card being dragged gets a 2 px copper outline and a "Dragging" label so it is clear without motion.

## Shapes
`md` (6 px) for buttons and fields, `lg` (10 px) for cards and columns, `sm` (4 px) for tags and urgency chips, `full` only for status badges.

## Components
Primary button: white on copper, 48 px high, one per screen. Secondary button: ink on white with a steel 1 px border (the `divider-strong` colour), 44 px. Fields: white with a steel 1 px border, 48 px high, label always above; an error field gets the red tint, a 2 px red border and a message with an icon beneath it. Status badge: icon, word, tint. Job tag: see the signature above. One icon family throughout: simple 2 px-stroke outline icons drawn inline (no emoji, no icon font).

## Motion
120 to 200 ms ease-out for state changes only: a moved card, a menu opening, a banner appearing. Nothing decorative and nothing loops, except the skeleton shimmer, which is replaced by a still skeleton under `prefers-reduced-motion`. Everything else is already still.

## Do's and Don'ts
- Do: one copper primary action per screen; ink text on white; status as icon plus word; reference numbers always as a job tag; the "Move to" menu always visible on cards (never hover-only).
- Do: label this look "proposal" in every Gate 2 packet until Matthew confirms it or supplies a real brand, which replaces this file whole.
- Don't: add a second accent colour or a gradient; use copper for large backgrounds or for status; use colour alone for status; put red, amber or green text on white or mist (only on their own tints, in badges); invent a logo, testimonial, review count, licence number or phone number.
