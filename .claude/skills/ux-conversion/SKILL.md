---
name: ux-conversion
description: Product and conversion sense for bl-designer — shape every screen around the action that moves the PRD's primary metric, cut friction and anxiety in key flows, add honest trust signals, and match what customers in the client's sector expect — with no dark patterns. Use while laying out any screen that sits on a conversion path (booking, checkout, signup, lead form, onboarding).
---

# Designer · Product & Conversion

Good-looking screens that don't move the PRD's primary metric have failed. Every screen on a conversion path should make the next step obvious, easy and safe-feeling.

## 1. Find the conversion path

From `docs/metrics-spec.md`, take the primary metric and its events (e.g. `booking_confirmed`). Trace the screens from first entry to that event — that path gets this skill's full treatment. Mark those screens `Conversion: yes` in the inventory.

## 2. Diagnose with motivation × ability × prompt

A user acts when they're motivated enough, it's easy enough, and something prompts them at the right moment.
- **Motivation** — is the value clear on the screen, in the client's customers' words? A weak value proposition can't be fixed with button colours; if it's unclear in the PRD, raise it as an open question.
- **Ability (friction)** — count it: fields, steps, decisions, required accounts, page loads. Remove before you restyle.
- **Prompt** — one primary action per view, labelled with the outcome ("Book Tue 10:00"), placed where the eye lands after the value is understood.
- **Anxiety** — the hidden killer: price surprises, unclear cancellation, "will they spam me", data worries. Answer them next to the action, not on a separate FAQ page.

## 3. Friction patterns

- Ask only for what the PRD needs now; defer the rest until after the first success.
- Guest path before account creation when the PRD allows it; social or magic-link sign-in over passwords.
- Smart defaults (most common option pre-selected **only** for neutral choices), input types and autofill for mobile.
- Show progress on multi-step flows; never lose entered data on back, error or refresh.
- Fast first paint on the conversion path (loading thresholds in `ux-components`).

## 4. Trust signals — honest only

- Real reviews and ratings the client actually has (the Review Engine and Google reviews are typical for Baseleap clients), real business details (address, phone, licence numbers for trades), clear pricing and cancellation terms, recognisable payment marks at checkout.
- Placed near the action they reassure — reviews near "Book", refund terms near "Pay".
- **Never invented**: no fabricated testimonials, counts, ratings or "as seen in" logos. If the client has none yet, design the slot and leave it empty with a note.

## 5. Sector expectations

Match what the client's customers already know from the sector's leading apps — a clinic booking flow should feel like booking flows patients already use; a contractor quote request like the trades sites they've seen. Note the 2–3 conventions you followed in the design spec. Familiar beats clever on a conversion path.

## 6. No dark patterns — ever

Not allowed in any Baseleap design, whatever the conversion gain:
- fake urgency or scarcity (countdown timers that reset, "only 2 left" that isn't true)
- confirmshaming ("No thanks, I don't like saving money")
- **pre-checked marketing consent** — Canada's anti-spam law (CASL) requires express consent, which a pre-checked box doesn't give; keep marketing opt-ins unchecked and separate from terms
- hidden costs revealed at the last step, sneak-into-basket, roach-motel cancellation, disguised ads
- making the non-preferred choice visually invisible when it's a real choice

Persuasion through clarity, relevance and honest reassurance only.

## 7. Measure it

Every conversion-path screen's key actions must have the events from `docs/metrics-spec.md`; if a step you designed has no event and you'd want to know where people drop off, add it to your report as a suggestion for the PM (the PM owns the metrics spec).

---
Sources (ideas adapted, text written for Baseleap): phazurlabs/sumi `conversion-optimization-patterns`, `sector-style-intelligence`, `performance-states-patterns` (Apache-2.0 — Fogg behaviour model, motivation/value/friction/anxiety, choice architecture), rampstackco/claude-skills `onboarding-wizard-design`, `experiment-design` (MIT), nextlevelbuilder/ui-ux-pro-max-skill product reasoning profiles (MIT). Ethics and CASL consent rule: Baseleap.
