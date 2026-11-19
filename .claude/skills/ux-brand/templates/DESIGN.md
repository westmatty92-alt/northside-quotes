---
version: alpha
name: Baseleap
description: Brand contract for Baseleap tools, built strictly from BASELEAP Brand Book v2 and the Brand Color System v1. Dark first; Volt is the one accent. No off-palette colours.
colors:
  midnight: "#0D1F2D"
  volt: "#00D4A0"
  canvas: "#F4F5F0"
  depth: "#1A1A2E"
  run: "#00A878"
  white: "#FFFFFF"
  success: "#22C55E"
  warning: "#F59E0B"
  error: "#EF4444"
  info: "#6366F1"
  primary: "{colors.midnight}"
  surface: "{colors.midnight}"
  surface-raised: "{colors.depth}"
  text: "{colors.white}"
  text-secondary: "{colors.canvas}"
  accent: "{colors.volt}"
  on-accent: "{colors.midnight}"
  secondary-action: "{colors.run}"
  on-secondary-action: "{colors.midnight}"
  input-border: "{colors.run}"
  focus: "{colors.volt}"
  surface-light: "{colors.canvas}"
  text-on-light: "{colors.depth}"
  border-on-light: "{colors.depth}"
  focus-on-light: "{colors.midnight}"
typography:
  display:
    fontFamily: Garet
    fontSize: 64px
    fontWeight: 800
    lineHeight: 1.1
  h1:
    fontFamily: Garet
    fontSize: 48px
    fontWeight: 800
    lineHeight: 1.2
  h2:
    fontFamily: Garet
    fontSize: 36px
    fontWeight: 800
    lineHeight: 1.25
  h3:
    fontFamily: Garet
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.3
  h4:
    fontFamily: Garet
    fontSize: 22px
    fontWeight: 400
    lineHeight: 1.4
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  ui-label:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
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
    backgroundColor: "{colors.volt}"
    textColor: "{colors.midnight}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  button-secondary:
    backgroundColor: "{colors.run}"
    textColor: "{colors.midnight}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  input:
    backgroundColor: "{colors.depth}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  card:
    backgroundColor: "{colors.depth}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.depth}"
    rounded: "{rounded.lg}"
    padding: 24px
  metric-value:
    textColor: "{colors.volt}"
    typography: "{typography.display}"
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.midnight}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.midnight}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
  badge-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.depth}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.full}"
---

## Overview
Dark first: the platform interface is Midnight, and intelligence lives in depth. Precision over decoration: every element earns its place. Volt commands attention, with one accent used on results, CTAs and the metrics that matter. Every visual pairs with an outcome (a health score, a lead count, a response time).

## Colors
Use the 60 · 20 · 10 rule: Midnight 60% (backgrounds, navigation, sidebars), Canvas 20% (cards, light sections, reports, client documents), Volt 10% (CTAs, the Health Score, key results, active states), Depth 10% (raised surfaces on dark, body text on light). Run is the secondary accent for progress bars and secondary actions. Success, Warning, Error and Info are functional only, never decorative.

Text on dark surfaces is White or Canvas. Text on light surfaces is Depth or Midnight, never raw black. The palette has no grey by design, so hierarchy comes from type size and weight, not tinted text.

Accessible pairings (WCAG AA, measured):
- White on Midnight 16.8:1 · Canvas on Midnight 15.3:1 · Volt on Midnight 8.7:1 · Run on Midnight 5.5:1
- Midnight on Volt 8.7:1 (primary button) · Midnight on Run 5.5:1 (secondary button)
- Depth on Canvas 15.6:1 · Midnight on Canvas 15.3:1
- Badges: Midnight on Success 7.4:1 · Midnight on Warning 7.8:1 · Depth on Error 4.53:1
- Status text on dark: Success 7.4:1 · Warning 7.8:1

## Typography
Garet ExtraBold for display, H1 and H2 (Health Score number, page titles, section headers). Garet Book for H3 and H4. Inter Regular for body copy, and Inter Medium for UI labels (buttons, form labels, nav, table headers, status labels). Fallback is system-ui, -apple-system, sans-serif.

## Layout
8 px rhythm from the spacing scale. Operator tables are dense (`sm` cell padding); forms, empty states and client-facing reports breathe (`lg`). Breakpoints are 640 / 1024 / 1280.

## Elevation & Depth
On dark, a raised surface is Depth on Midnight with no shadows. On light, Canvas cards use a 1 px Depth border.

## Shapes
`md` for controls, `lg` for cards, `full` only for badges and avatars.

## Motion
Forward motion with purpose: 120–200 ms ease-out for state changes and nothing decorative. Everything is off under `prefers-reduced-motion`.

## Do's and Don'ts
- Do: Volt for CTAs and action elements only; Midnight text on Volt; Midnight as the dominant surface; Volt focus rings on dark and Midnight focus rings on light; status shown with an icon and text, never colour alone.
- Don't: add off-palette colours; white text on Volt (1.9:1); Volt as a large background; Depth text on Midnight (1.0:1); semantic colours as text on Canvas or White (all below 4.5:1); Error-coloured small text on Midnight (4.46:1; use White text with an Error icon or border); Info for any text (use it for icons and borders beside White text); Volt or Run as text on light surfaces.
