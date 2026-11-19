# Design Specs: <Product>

**Status:** proposed (locked at Gate 2) · **Brand contract:** `DESIGN.md` (source: <client kit / Baseleap / new>) · **Generated:** `src/app/theme.css`, `docs/tokens.json` · **Flows:** `docs/user-flows.md`
**Signature element:** <one line>

## Screens and flows
Screen inventory, navigation and flows live in `docs/user-flows.md`. This file covers how each screen looks and behaves.

## Screens
### SCR-01 · <Booking list>
- **Purpose:** <the one thing the user does here>
- **Stories:** US-002 · **Mockup:** `design/mockups/SCR-01-booking-list.html`
- **Screenshots:** `docs/design/screens/SCR-01-mobile.png` · `SCR-01-desktop.png`
- **Layout notes:** <hierarchy, focal point, what changes at each breakpoint>
- **States:**
  | State | Design | AC |
  |---|---|---|
  | empty | <"No bookings yet" + Book button> | — |
  | loading | <skeleton of 5 rows> | — |
  | error | <banner: couldn't load, Retry; last data kept> | AC-002.3 |
  | success | primary mockup | AC-002.1 |
  | disabled / no permission | N/A — every signed-in user sees their own list | — |

## Component map
| Component | Base | Variants | Used on | Notes (keyboard, ARIA) |
|---|---|---|---|---|
| Button | shadcn `Button` | primary, secondary, ghost, destructive | all | one primary per view |

## Responsive behaviour
| Breakpoint | Changes |
|---|---|
| < 640 | <tables → stacked cards; nav → bottom bar> |
| 640–1024 | <…> |
| ≥ 1024 | <…> |

## GHL embed
- Embed screens: <SCR-02> · container width: <800 px default / confirmed width> · no app chrome · links out open new tab
- Sign-in inside the frame: per `docs/SECURITY_MODEL.md`

## Accessibility notes
- Keyboard paths for custom widgets: <SlotGrid: arrows move, Enter selects, Esc closes>
- Live announcements: <"Booking confirmed for Tue 10:00">
- Exceptions (with reason): <none>

## Conversion path
- Screens on the path to the primary metric: <SCR-02 → confirmation>
- Friction removed: <guest booking, 1 field>
- Anxiety answered at the action: <cancellation terms, reviews near Book>
- Sector conventions followed: <…>

## Copy
| Where | Text |
|---|---|
| SCR-02 confirm button | <Book 10:00> |
| Slot taken | <That time was just taken. Here are the next 3 open slots.> |

## Open questions
| # | Question | Options (recommended first) | Owner |
|---|---|---|---|
| DQ-1 | <…> | <A (rec) / B> | Matthew |
