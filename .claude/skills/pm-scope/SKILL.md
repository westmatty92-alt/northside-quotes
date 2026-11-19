---
name: pm-scope
description: Scope discipline for bl-pm — cut the idea to the smallest version that delivers the job, rank everything with MoSCoW (RICE when it's close), and write explicit non-goals so nobody downstream builds what wasn't asked for. Use after discovery, before writing stories.
---

# PM · Scope

The cheapest feature is the one nobody builds. Your job here is to make the v1 small enough to ship in one run and to write down — explicitly — everything that isn't in it.

## 1. Find the thinnest end-to-end slice

Ask: what is the *smallest* thing a real user can do, start to finish, that delivers the job from discovery? That slice is the spine of v1. Everything else attaches to it or waits.

Example: a clinic booking app's spine is "a patient picks a slot and gets a confirmation" — not "patients, staff, admin, reminders, payments, reporting".

## 2. MoSCoW every candidate feature

| Bucket | Meaning | Lands in |
|---|---|---|
| **Must** | v1 fails its job without it | user stories (Priority: Must) |
| **Should** | important, but v1 still works without it | user stories (Priority: Should) — first to cut if the plan runs long |
| **Could** | nice if cheap | user stories (Priority: Could) — only if the architect says it's nearly free |
| **Won't (this time)** | explicitly not v1 | PRD **Non-goals** with a one-line reason |

Rules:
- **Musts ≤ 60% of the total story count.** If everything is a Must, nothing is — re-cut.
- Every Must traces to the problem statement or the "done" outcome from intake. If it doesn't trace, it isn't a Must.
- Security, permissions and data protection for the features you *do* include are never deferred — they're part of the Must, not separate Should stories.

## 3. When two things compete — RICE

Use RICE only to break a real tie (don't score the whole list — that's ceremony):

`RICE = (Reach × Impact × Confidence) ÷ Effort`
- Reach: users affected per month · Impact: 3 massive / 2 high / 1 medium / 0.5 low · Confidence: 100 / 80 / 50% · Effort: rough person-days (ask the architect's estimate if it exists; otherwise mark "PM guess").

Show the two scores and the call in the PRD's scope section. Low confidence (50%) on the winner → it's an Open Question for Matthew, not a decision.

## 4. Non-goals are a deliverable

Write them as firmly as features. Each one: *what* is out, *why*, and *when it might come back*.

- ✅ "No staff scheduling in v1 — the clinic manages shifts in their current tool; revisit after 30 days of bookings."
- ❌ "Advanced features may come later."

Non-goals are what stop the designer adding screens and the architect adding tables for things nobody asked for. Downstream agents treat them as hard boundaries.

## 5. Reality check before you hand off

- Could this v1 realistically finish in **one build run** (roughly ≤ 25 build steps)? If not, propose a v1 / v1.1 cut in your report rather than writing an enormous PRD.
- Does any Must depend on something outside our control (client's data export, a third-party API approval, a payment account)? → Dependency + Open Question with an owner.
- Did scope drift from the intake "done" outcome? If yes, say so in the report — Matthew decides at Gate 1.

You **propose** scope; Matthew **approves** it at Gate 1 · scope_approval. Anything you're unsure about is an Open Question, never a silent decision.

---
Sources (ideas adapted, text written for Baseleap): anthropics/knowledge-work-plugins `write-spec` (Apache-2.0, MoSCoW in the PRD), product-on-purpose/pm-skills `define-prioritization-framework` (Apache-2.0, RICE/ICE applicability, sensitivity), pratikshadake/claude-product-management-skills `value-vs-effort`, `tradeoff-articulator`, `roadmap-reality-checker` (MIT), Sidsaladi9/persona-os `user-stories` (MIT, thinnest end-to-end slice).
