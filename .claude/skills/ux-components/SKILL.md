---
name: ux-components
description: Component map and state design for bl-designer — map every UI element to a shadcn/ui base or a named custom component with its variants, and design every state (empty, loading, error, success, disabled) plus forms and feedback, so the frontend never has to invent one. Use alongside screen layout.
---

# Designer · Components & States

Happy-path mockups are half a design. The frontend agent will hit every empty list, slow request and failed save — if you didn't design it, it will improvise, and improvised states are where products look broken.

## 1. Component map

In `docs/design-specs.md`, one table for every component used on any screen:

| Component | Base | Variants | Used on | Notes |
|---|---|---|---|---|
| Button | shadcn `Button` | primary, secondary, ghost, destructive; sm/md | all | one primary per view |
| SlotGrid | custom | default, compact (embed) | SCR-02 | keyboard: arrows move, Enter selects |
| StatusBadge | shadcn `Badge` | confirmed, cancelled, pending | SCR-01 | colour + text, never colour alone |

Rules:
- **Reuse before inventing.** shadcn/ui base components first (house stack); a custom component needs a reason.
- Variants map to `DESIGN.md` component entries (`button-primary`, `button-primary-hover`, …). A variant that isn't in DESIGN.md gets added there first.
- One icon family across the product.

## 2. The state matrix — every data-bearing component and screen

| State | Design it as |
|---|---|
| **Empty** (first use) | what it is, why it's empty, the one action that fills it — never a blank area |
| **Loading** | < 100 ms nothing · 100 ms–1 s skeleton in the real layout shape · 1–10 s clear progress · > 10 s progress + "we'll notify you" / background |
| **Error** | what went wrong in plain words, what's kept, the retry action; field-level errors next to the field |
| **Partial / stale** | some data failed or is out of date — what's shown and how it's marked |
| **Success** | confirmation that names what happened ("Booked for Tue 10:00"); optimistic UI only when rollback is designed |
| **Disabled / no permission** | why it's unavailable; hide only what the role must never know exists |

Each Must story's `[edge]` and `[error]` criteria map to a designed state — reference the AC IDs in the matrix.

## 3. Forms

- Label above the field, always visible (no placeholder-as-label).
- Validate on blur and on submit, not on every keystroke; errors say how to fix.
- Required vs optional marked once, consistently; sensible input types (email, tel, date) for mobile keyboards.
- Destructive or costly actions confirm with the specific consequence ("Cancel booking for Tue 10:00? This can't be undone.").

## 4. Feedback & motion

- Every action gets feedback within 100 ms (pressed state, spinner on the button, toast on completion).
- Motion only where it explains something (a change of state, where something went); durations and easing from `DESIGN.md`; everything honours `prefers-reduced-motion`.

## 5. Mockup coverage

Each screen's mockup shows its **primary state**; the other states get either their own mockup file (`SCR-NN-<slug>--empty.html`, `--error.html`) when the layout changes, or a precise description in the state matrix when it doesn't. The checker requires every screen to list all states (designed or "N/A — reason").

---
Sources (ideas adapted, text written for Baseleap): owl-listener/designer-skills `component-spec`, `loading-states`, `error-handling-ux`, `form-design`, `feedback-patterns`, `state-machine` (MIT — loading-duration thresholds, optimistic UI with rollback), buildgreatproducts/builder-os `design-better` (MIT — states and forms heuristics), nextlevelbuilder/ui-ux-pro-max-skill (MIT — component tokens). ulpi-io/skills component-spec template reviewed for ideas only (no licence).
