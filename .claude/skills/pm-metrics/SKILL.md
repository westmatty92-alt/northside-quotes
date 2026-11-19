---
name: pm-metrics
description: Write docs/metrics-spec.md for bl-pm — the one success metric that proves v1 did its job, its guardrails, and the exact analytics events the developers must fire (names, triggers, properties, PII handling) so success is measurable from day one. Use alongside the PRD.
---

# PM · Success Metrics & Instrumentation

If you can't say how we'll know v1 worked, the PRD isn't finished. This file turns "success" into numbers and into events the developers wire up — so measuring isn't a project after launch.

## 1. One primary metric

Pick the **one** number that moves if v1 does its job (from the discovery job-to-be-done). For each metric:

| Field | Example |
|---|---|
| Metric | Online bookings per week |
| Definition | count of `booking_confirmed` events, de-duplicated by booking id |
| Baseline | ~0 online (all by phone/DM) — source: research record |
| Target | ≥ 40 / week |
| Window | 30 days after launch |
| Owner | Matthew (client review at day 30) |

No baseline available → write "unknown — measure for 14 days first" and make that an Open Question. Never invent a baseline.

## 2. Guardrails (2–3)

Things that must **not** get worse while the primary moves: refund rate, support messages, page errors, no-show rate, time-to-complete. Same table shape, with a threshold instead of a target.

## 3. Leading indicators (optional, ≤ 3)

Early signals you can read in week one (e.g. booking-flow start → confirm rate). Only include ones you'd act on.

## 4. Event inventory — what the code must fire

Every metric must be computable from these events. Columns are fixed (the checker parses them):

| Event | Fires when (exactly) | Properties (name: type) | PII | Feeds metric |
|---|---|---|---|---|
| `booking_started` | patient opens the slot picker | `clinic_id: uuid`, `source: enum(web,ghl_embed)` | none | Booking conversion |
| `booking_confirmed` | the booking is **saved** (server-side), not when the button is clicked | `booking_id: uuid`, `clinic_id: uuid`, `lead_time_hours: int` | none | Online bookings / week |

Rules:
- `snake_case`, `object_action` names (`booking_confirmed`, not `ConfirmBooking` or `clickedConfirm`).
- "Fires when" is precise: click vs successful save are **different events**.
- **Fire money and state-change events server-side** — the client can be closed mid-flow.
- **PII column is mandatory.** Default: no names, emails, phone numbers or free text in event properties — use ids. If PII is genuinely needed, say how it's protected (hashed, excluded from the analytics tool, retention) — the security agent will check this.
- If a model's input/output is logged (agent features), name exactly what's captured, what's redacted before it leaves the server, who can read it and how long it's kept.

## 5. Where it goes

Name the destination(s) so the architect can plan it: GA4 / Meta Pixel (marketing pages), GHL (marketing and campaign events), or a Supabase `events` table (in-app product analytics). One source of truth per metric.

## 6. QA checklist

End with how QA verifies tracking: for each event, the action that should fire it and the properties to check. QA folds these into the E2E tests.

---
Sources (ideas adapted, text written for Baseleap): product-on-purpose/pm-skills `measure-instrumentation-spec` (Apache-2.0 — event inventory, precise triggers, PII and trace handling, QA checklist), anthropics/knowledge-work-plugins `write-spec` (Apache-2.0 — leading vs lagging indicators, targets), pratikshadake/claude-product-management-skills `outcome-definition` (MIT). Digidai/product-manager-skills and deanpeters SaaS-metrics packs reviewed for ideas only (CC BY-NC-SA).
