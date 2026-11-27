---
version: alpha
name: Northside Plumbing
description: Brand contract for Northside quote requests, built from the client's own brand guide and wordmark (.baseleap/inputs/brand/). Harbour Teal for the header, primary buttons and links, Paper for the page, Fog for cards and dividers, Steel Ink for text, and Copper kept for large marks and graphics on light surfaces. Barlow Semi Condensed headings and Source Sans 3 body, self-hosted. Dependable, quick, plain-spoken, a bit of steel-town grit.
colors:
  teal: "#0B4F6C"
  copper: "#C8742B"
  ink: "#14212B"
  paper: "#FAF7F2"
  fog: "#E6E1D8"
  ink-soft: "#475057"
  ink-faint: "#737B80"
  green: "#1E6B3C"
  green-tint: "#E2F2E8"
  amber: "#7A4A00"
  amber-tint: "#FCF0D6"
  red: "#B3261E"
  red-tint: "#FBE6E4"
  primary: "{colors.teal}"
  primary-hover: "{colors.ink}"
  on-primary: "{colors.paper}"
  surface: "{colors.paper}"
  surface-raised: "{colors.fog}"
  surface-inverse: "{colors.teal}"
  surface-deep: "{colors.ink}"
  neutral-surface: "{colors.fog}"
  text: "{colors.ink}"
  text-secondary: "{colors.ink-soft}"
  text-inverse: "{colors.paper}"
  accent: "{colors.copper}"
  border: "{colors.fog}"
  border-strong: "{colors.ink-faint}"
  focus: "{colors.ink}"
  focus-on-dark: "{colors.paper}"
  success: "{colors.green}"
  success-surface: "{colors.green-tint}"
  warning: "{colors.amber}"
  warning-surface: "{colors.amber-tint}"
  danger: "{colors.red}"
  danger-surface: "{colors.red-tint}"
  info-surface: "{colors.fog}"
typography:
  display:
    fontFamily: Barlow Semi Condensed
    fontSize: 44px
    fontWeight: 700
    lineHeight: 1.05
  h1:
    fontFamily: Barlow Semi Condensed
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.15
  h2:
    fontFamily: Barlow Semi Condensed
    fontSize: 25px
    fontWeight: 600
    lineHeight: 1.2
  h3:
    fontFamily: Barlow Semi Condensed
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.25
  body-lg:
    fontFamily: Source Sans 3
    fontSize: 19px
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: Source Sans 3
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Source Sans 3
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  ui-label:
    fontFamily: Source Sans 3
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.25
  label-sm:
    fontFamily: Source Sans 3
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.04em
  ref:
    fontFamily: Barlow Semi Condensed
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.1em
  ref-display:
    fontFamily: Barlow Semi Condensed
    fontSize: 44px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: 0.12em
rounded:
  sm: 2px
  md: 4px
  lg: 8px
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
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
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: 24px
  card:
    backgroundColor: "{colors.surface-raised}"
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
    height: 64px
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-sm}"
    height: 64px
  tab-bar-current:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    typography: "{typography.label-sm}"
    height: 64px
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.ui-label}"
    height: 44px
  badge-new:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
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
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
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
  pipe-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  icon-error:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
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
**Brand source: the client's own files.** `.baseleap/inputs/brand/brand-guide.md` and `northside-wordmark.svg` (Matthew's ruling, ledger decision 2026-11-20). `.baseleap/inputs/brand/README.md` is a stale Console export that says there are no files; it is ignored. There is no website or app to match, so every colour role below is the one the guide itself assigns ("Use" column); nothing was borrowed from an existing screen. The earlier navy-and-copper proposal is gone and the PROPOSAL label with it.

The guide's personality is a family trade business in Hamilton's North End: dependable, quick, plain-spoken, a bit of steel-town grit, not corporate and not cute. In use that means a deep Harbour Teal header, warm Paper pages, Steel Ink text, condensed trade-sign headings and plain sentences that say what happens next and when.

**Signature element: the job tag, hung from the copper pipe.** Plumbers hang a tag on a job. The reference number (`NQ-7K3M9P`) is always shown as a small tag: Barlow Semi Condensed Bold, letter-spaced like stamped metal, Paper on Harbour Teal with a punched hole at one end (on the confirmation and the request detail, where it also hangs from a copper elbow, the shape of the pipe in the wordmark), or a quiet Fog tag in rows and cards. It is the one object the homeowner keeps and the one the owner quotes back on the phone, so it is the one thing styled differently. The wordmark itself carries the pipe, so the elbow ties the tag to the logo without a second logo-like mark.

**Wordmark.** The supplied `northside-wordmark.svg` is used as given. Minimum height 28 px on screens (the header uses 44 px so "PLUMBING · HAMILTON" stays legible); on Harbour Teal the wordmark text is Paper and the pipe stays Copper. It sits in the header of every page. The supplied file uses live text in Barlow Semi Condensed and Source Sans 3, so the build ships it with the text converted to outlines (or with those fonts loaded) so it never falls back to a system font.

## Colors
Roles, not decoration. The five brand colours are exactly the guide's.
- **Harbour Teal** (`teal`, role `primary`): the header, primary buttons, links, the active filter segment, the New badge, the job tag. Paper on teal is 8.4:1 (so is teal on Paper, for links); teal on Fog is 6.9:1.
- **Copper** (`copper`, role `accent`): the pipe mark and emphasis, **large text and graphics on light surfaces only**, as the guide says. On Paper it is 3.3:1, which passes for graphics and large text (3:1) and fails for small text (4.5:1). So copper is never body text, never a small label, never a button fill, never a link colour, and never sits on teal, ink or Fog (2.5:1 or less). Used for: the wordmark pipe, the elbow on the display job tag, the Emergency chip's icon and left bar (always with the word), the top rule on the confirmation, the outline of a card being dragged (always with the word "Dragging").
- **Steel Ink** (`ink`, role `text`): all body text (15.3:1 on Paper, 12.6:1 on Fog), the primary button's hover colour, the focus ring and the photo viewer background.
- **Paper** (`paper`, role `surface`): the page, the primary button label, the field fill, the board card.
- **Fog** (`fog`, roles `surface-raised`, `border`): cards, the weekly tiles, board columns, skeletons, dividers and the Lost badge.
- **Derived neutrals (not new hues).** `ink-soft` is Steel Ink pulled 22% toward Paper for secondary text (7.7:1 on Paper, 6.3:1 on Fog). `ink-faint` is the same pull at 50% for the border of fields and menus (4.0:1 on Paper, 3.3:1 on Fog; borders need 3:1).
- **Functional colours (not brand; flagged for Matthew).** The guide has no error, success or warning colour and the product needs them: red for errors, green for Won and saved, amber for Quoted and waiting. They carry state only, never decoration; each is used as dark text on its own tint, inside a badge or a banner, and always with an icon and a word. Pairings: green on green-tint 5.6:1, amber on amber-tint 6.6:1, red on red-tint 5.5:1, red on Paper 6.1:1, ink on any tint 11:1 or better. If Northside would rather have them from the palette, Won and Quoted would become teal-outlined badges and errors would lose their red; that is a client decision.
- **Focus** is a 3 px Steel Ink ring with a 2 px gap on Paper and Fog (14:1 or better) and a Paper ring on teal and on the photo viewer.

Accessible pairings (computed): Paper on teal 8.4 · teal on Paper 8.4 · teal on Fog 6.9 · ink on Paper 15.3 · ink on Fog 12.6 · ink-soft on Paper 7.7 · ink-soft on Fog 6.3 · ink-faint on Paper 4.0 (borders only) · copper on Paper 3.3 (graphics and large text only) · red on Paper 6.1.

## Typography
Headings: **Barlow Semi Condensed** (Bold for display, h1; SemiBold for h2, h3): the industrial trade-sign feel the guide asks for. Body: **Source Sans 3** (Regular for text, SemiBold for labels, buttons and badges). Both are Google Fonts under the SIL Open Font License, **self-hosted** as woff2 (Latin subset, the four weights above) and preloaded for the weights above the fold, with `font-display: swap` and a system fallback of the same width (Arial Narrow for headings, `system-ui` for body), so nothing is fetched from a font CDN and the public form stays inside the 3-second 4G budget. The reference number uses Barlow Semi Condensed Bold, tracked out; there is no monospace font (the reference format already excludes I, L and O so characters are not confused). Scale: display 44 for the reference number figure and the weekly counts, h1 34, h2 25, h3 21, body-lg 19, body 17 (never smaller for reading text), body-sm 15 only for meta (times, hints), label-sm 15 semibold with slight tracking for badges and column headers. Condensed headings are set a size up from a normal face so they hold their weight on a phone.

## Layout
8 px rhythm from the spacing scale (4, 8, 16, 24, 32, 48). Phone first at 390 px; breakpoints at 640, 1024 and 1280. Public pages: one column, 560 px maximum, generous spacing. Staff pages: content up to 1120 px; the Pipeline tab up to 1280 px. **Navigation:** from 640 px the two tabs sit in the teal top bar beside the wordmark; below 640 px the top bar keeps only the wordmark and Sign out and the tabs move to a bottom tab bar, 64 px high, with an icon above each label. Declared constants used in mockups and code: touch target 44 px minimum and 48 px for primary actions and form fields; board column minimum width 240 px; hairline borders 1 px and focus ring 3 px; wordmark height 44 px. Staff screens are dense (`sm` and `md` cell padding); the public form and the confirmation breathe (`lg`).

## Elevation & Depth
Flat. No shadows. A raised area is Fog on Paper; a board card is Paper on a Fog column; a list is Paper with Fog dividers; the open "Move to" menu is Paper with a 1 px ink-faint border; a card being dragged gets a 2 px copper outline and a "Dragging" label so it is clear without motion.

## Shapes
Slightly squared, like a steel plate: `md` (4 px) for buttons and fields, `lg` (8 px) for cards and columns, `sm` (2 px) for tags and urgency chips, `full` only for status badges.

## Components
Primary button: Paper on Harbour Teal, 48 px high, one per screen; hover turns Steel Ink. Secondary button: ink on Paper with an ink-faint 1 px border, 44 px. Fields: Paper with an ink-faint 1 px border, 48 px high, label always above; an error field gets the red tint, a 2 px red border and a message with an icon beneath it. Checkbox: 24 px square (44 px target with its label), ink-faint border, teal fill with a Paper tick when on; never ticked when a page loads. Status badge: icon, word, fill; New is teal with Paper text, Quoted amber, Won green, Lost Fog. Urgency chip: icon, word; Emergency adds the copper icon and left bar on Paper. Tabs: teal top bar on 640 px and up (current tab underlined in Paper, `aria-current="page"`); bottom tab bar on phones (current tab Fog with a teal top bar, teal bold label). Job tag: see the signature above. One icon family throughout: simple 2 px-stroke outline icons drawn inline (no emoji, no icon font).

## Motion
120 to 200 ms ease-out for state changes only: a moved card, a menu opening, a banner appearing. Nothing decorative and nothing loops, except the skeleton shimmer, which is replaced by a still skeleton under `prefers-reduced-motion`. Everything else is already still.

## Do's and Don'ts
- Do: one teal primary action per screen; ink text on Paper; status as icon plus word; reference numbers always as a job tag; the "Move to" menu always visible on cards (never hover-only); the wordmark in the header at 28 px or taller, Paper text on teal.
- Do: keep copper to large marks and graphics on Paper, always paired with a word where it carries meaning.
- Do: write the way the guide says: short sentences, say what happens next and when, concrete prices and times.
- Don't: use copper for small text, links, buttons or on teal, ink or Fog; add a second accent colour or a gradient; use colour alone for status; put red, amber or green text on Paper or Fog (only on their own tints, in badges and banners); load a font from a CDN; redraw or recolour the wordmark.
- Don't: invent a testimonial, review count, licence number or phone number.
