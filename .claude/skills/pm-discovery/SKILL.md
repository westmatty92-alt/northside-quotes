---
name: pm-discovery
description: Problem discovery for bl-pm — find the real problem, the people who have it and the job they hire the product for, and turn every gap into a lettered-option question the orchestrator can put to Matthew. Use at the start of every PM step, before scoping or writing anything.
---

# PM · Discovery

You don't write requirements until you can state the problem in one sentence that names who has it, when, and what it costs them. Discovery is how you get there without inventing anything.

## 1. Read what already exists (before asking anything)

In this order, from your context packet:
1. The dispatch brief and **intake decisions** (the orchestrator already asked Matthew the build-level questions: what "done" means, what must not change, platform, spend).
2. `.baseleap/inputs/client-research.md`: what the Client Research Agent and Audit Assistant captured about the client (business, customers, current stack, gaps found on the audit call). **This is your strongest evidence. Use it before asking.**
3. `.baseleap/inputs/discovery-answers.md`: Matthew's answers, if this is your second pass.
4. Any existing `docs/` (for a v2, the previous PRD and what shipped).

The intake decisions include the **build mode** (`in_platform`, `platform_extension`, `hybrid` or `custom`; see `build-specs/build-modes.md`). Write requirements that fit it. In `in_platform`, a requirement is something the client's CRM must do, not a screen we build. You don't choose or change the mode. If the evidence contradicts it (for example, the research says they're leaving GHL but the mode says `in_platform`), raise it as a lettered question with a recommendation. That is a needs-answers reason on its own.

Never invent a persona, a metric baseline, or a customer quote. If the evidence isn't there, it becomes a question.

## 2. Frame the problem

Write these for yourself first. They go into the PRD Overview.

- **Problem statement:** *When [situation], [who] struggles to [progress they want], which costs them [time / money / customers / risk]. Today they [workaround].*
- **Job to be done:** *When [circumstance], I want to [progress], so I can [outcome].* Name the circumstance, not demographics. Never name the product.
- **Forces:** push (what's painful now), pull (what's attractive about a fix), anxiety (what makes them hesitate), habit (what keeps them on the workaround). Anxiety and habit kill adoption more often than missing features, so note them; they become edge cases and onboarding requirements.
- **Proto-personas:** 1–3, each tied to evidence (research record line, Matthew's answer). A persona without evidence is a question, not a persona.
- **Severity:** how often the pain happens × how bad it is. Low-frequency + low-severity means you say so plainly in your report. Building the wrong thing well is still waste.

## 3. Questions — the two-pass protocol

You never talk to Matthew directly. On your **first pass**, if anything material is unknown, write `docs/discovery-questions.md` and stop with **Status: needs-answers**. The orchestrator asks Matthew and resumes you. That's a normal pass, not a failed attempt.

Rules:
- **5–7 questions max**, product-level only. Don't re-ask anything in the intake decisions or the research record.
- Each question gets **2–4 lettered options plus your recommended answer**, so Matthew can reply "1A, 2C, 3B" in seconds.
- Cover, in this order, only what's unresolved: target user and their job · the one outcome that matters most · roles and permissions (who can see/do what) · money (does this take payment, what plan or pricing applies) · MVP boundary (what's explicitly v2) · data that already exists vs must be created · success signal.
- One decision per question. No compound questions.

```markdown
# Discovery questions — <product>
Context I already have: <2–3 lines from research + intake, so Matthew sees you did the reading>

1. Who books the appointment?
   A. The client's customers, self-serve online  ← recommended (research: 70% of bookings come by DM today)
   B. Front-desk staff on the customer's behalf
   C. Both, with staff able to override
2. …
```

## 4. Market check (only when it changes a decision)

For a new product or a client-facing tool, a quick competitor check helps: what 2–3 alternatives do, and what the client's customers already expect. Rules:
- **≤ 5 searches.** Cite every source URL in the PRD appendix.
- **Required for a new build** (`# New build:` at the top of `client-research.md`). With no client and no research record, the market is the only outside evidence you have. Use it for the personas' alternatives and for a realistic baseline.
- Skip it for internal tools and well-understood builds.
- Facts about competitors go in the PRD as evidence, not as features to copy.

## 5. Exit condition

Discovery is done when you can fill the PRD Overview (problem, job, personas with evidence, why now) with no `[TBD]` and every open item is either answered or listed under Open Questions with an owner.

---
Sources (ideas adapted, text written for Baseleap): wondelai/skills `jobs-to-be-done` (MIT, job statement + four forces), pratikshadake/claude-product-management-skills `problem-clarity` + `jtbd-extractor` (MIT), snarktank/ralph `prd` (MIT, lettered-option clarifying questions), product-on-purpose/pm-skills `define-problem-statement` + `foundation-persona` (Apache-2.0, evidence-backed personas, never invent). deanpeters/Product-Manager-Skills discovery pack reviewed for ideas only (CC BY-NC-SA — no text reused).
