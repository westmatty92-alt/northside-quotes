---
name: pm-stories
description: Write docs/user-stories.md for bl-pm — INVEST vertical-slice stories with numbered Given/When/Then acceptance criteria in a strict format QA and the ledger's checker can parse. Use after scope is set, alongside the PRD.
---

# PM · User Stories & Acceptance Criteria

`docs/user-stories.md` is the list QA turns into tests, criterion by criterion. The format is strict because a script checks it and QA maps tests to the IDs — keep it exactly as the template shows.

## 1. Format (copy `templates/user-stories.md`)

```markdown
### US-003: Patient books an open slot
Priority: Must · Persona: Patient · Serves FR: FR-2

As a patient, I want to book an open appointment slot online, so that I don't have to call during business hours.

**Acceptance criteria**
- **AC-003.1** [happy] Given an open 30-min slot tomorrow at 10:00, when the patient confirms it, then the slot shows as booked and a confirmation email is sent within 1 minute.
- **AC-003.2** [edge] Given another patient booked the same slot a moment earlier, when this patient confirms, then they see "That time was just taken" and the next 3 open slots.
- **AC-003.3** [error] Given the email service is down, when a booking is confirmed, then the booking is still saved and the email is retried (the patient sees the booking on screen).
- **AC-003.4** [nfr] Given a 4G phone, when the slot list opens, then it renders within 2 s.

**Out of scope:** recurring appointments (Non-goal NG-2).
```

Rules the checker enforces:
- Story heading `### US-NNN: <title>` — IDs unique, three digits, never reused.
- A `Priority:` line with **Must**, **Should** or **Could** (Won't items are PRD non-goals, not stories), plus `Persona:` and `Serves FR:`.
- The story sentence has **As a … I want … so that …** — the "so that" is the value; never drop it.
- Criteria are `**AC-NNN.n**` with a tag: `[happy]`, `[edge]`, `[error]`, `[nfr]`.
- **Every story has a `[happy]` and at least one `[edge]` or `[error]`.**
- Every criterion has **Given … when … then …** and an observable result.

## 2. INVEST each story

- **Independent** — minimal ordering on other stories; note real dependencies in the story.
- **Negotiable** — behaviour, not implementation.
- **Valuable** — the "so that" names user or business value.
- **Estimable** — the architect could size it.
- **Small** — one developer step, ideally one sitting. Bigger → split.
- **Testable** — every criterion is pass/fail without interpretation.

## 3. Splitting patterns (when a story is too big)

Workflow steps · business-rule variations · happy path first, edge paths after · simple before complex · one input type before many · create/read before update/delete · make it work before making it fast. **Vertical slices only** — never "build the API" or "build the schema" as a story; those are the architect's and developers' steps.

## 4. Writing criteria that test well

- One outcome per criterion. Two outcomes → two criteria.
- Concrete data in the Given ("an open 30-min slot tomorrow at 10:00"), not "valid data".
- Observable Then — what the user sees, what's stored, what's sent. Never "it works".
- Banned (the checker flags them): *correctly, properly, appropriately, seamlessly, user-friendly, intuitive, fast, robust, etc., and so on*.
- Non-functional only where it matters (performance on the critical path, accessibility for public-facing screens, audit trail for money or permissions).
- For model-driven features, a criterion states the pass rule for a case, and the rate lives in the PRD's AI-behaviour section.

## 5. Suggested build order

End the file with the order you'd build the Musts — thinnest end-to-end slice first. The orchestrator uses it as a hint when it plans the build waves; the architect may reorder for technical dependencies.

---
Sources (ideas adapted, text written for Baseleap): Sidsaladi9/persona-os `user-stories` (MIT — INVEST, splitting patterns, vertical slices), product-on-purpose/pm-skills `deliver-acceptance-criteria` (Apache-2.0 — happy/edge/error/non-functional grouping), snarktank/ralph `prd` (MIT — US-NNN IDs sized for one agent session), alirezarezvani/claude-skills `agile-product-owner` (MIT). deanpeters `user-story` + `user-story-splitting` reviewed for ideas only (CC BY-NC-SA).
