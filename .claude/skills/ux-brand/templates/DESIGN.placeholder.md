---
version: alpha
name: Placeholder
description: Neutral placeholder brand from the Baseleap kit. Used only when Matthew chooses it because the client's brand isn't ready; every screen uses these tokens, so the real brand replaces this file later without touching the screens. Not a brand — never ship it to a client as one.
colors:
  ink: "#1C2128"
  slate: "#4A5361"
  paper: "#FFFFFF"
  mist: "#F2F4F7"
  line: "#D5DAE1"
  accent: "#1D4ED8"
  success: "#15803D"
  warning: "#B45309"
  error: "#B91C1C"
  primary: "{colors.ink}"
  surface: "{colors.paper}"
  surface-raised: "{colors.mist}"
  text: "{colors.ink}"
  text-secondary: "{colors.slate}"
  on-accent: "{colors.paper}"
  border: "{colors.line}"
  focus: "{colors.accent}"
typography:
  display:
    fontFamily: system-ui
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.15
  h1:
    fontFamily: system-ui
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.2
  h2:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
  h3:
    fontFamily: system-ui
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.35
  h4:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
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
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: 4px
  md: 8px
  lg: 12px
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
    textColor: "{colors.paper}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  button-secondary:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-muted:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.slate}"
    rounded: "{rounded.lg}"
    padding: 16px
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.paper}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.paper}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
  badge-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.paper}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
---

## Overview
A deliberately plain placeholder: ink on white, one blue accent for the main action, system fonts. It exists so screens can be designed and built before the client's brand is ready. Swapping in the real `DESIGN.md` re-themes every screen, because mockups and code use only these tokens.

## Colors
One accent (blue) for the single primary action per screen and for focus rings. Everything else is ink, slate and white, with mist for raised areas and line for borders. Semantic colours are for status only, always with an icon and a word.

## Typography
The platform's system font at every level: no web fonts to load, and nothing that suggests a brand. Hierarchy comes from size and weight.

## Layout
8 px rhythm from the spacing scale. Phone first at 390 px; content width up to 1120 px.

## Elevation & Depth
No shadows. Raised areas are mist on white; cards on white get a 1 px line border.

## Shapes
`md` for controls, `lg` for cards, `full` only for badges.

## Components
Primary button: white on blue. Secondary button: ink on mist. Inputs: white with a line border and a blue focus ring.

## Do's and Don'ts
- Do: one blue primary action per screen; status as icon plus word; label it "placeholder" in the Gate 2 packet.
- Don't: present this as the client's brand; add colours to it (the real brand replaces it whole); use blue for text other than links.
