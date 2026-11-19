---
name: pm-handoff
description: Cross-role translation for bl-pm — make the PRD set readable by the designer, architect, QA and Matthew without the PM in the room, flag technical considerations without designing the system, and write the step report the orchestrator turns into the Gate 1 packet. Use as the last thing before reporting.
---

# PM · Handoff

You're done when four different readers can each act on your docs without asking you anything. This skill is the final pass that makes sure of that.

## 1. Read it as each downstream reader

| Reader | Needs to find, fast | Check |
|---|---|---|
| **Matthew** (Gate 1) | what's in, what's out, the one metric, open questions | Overview + Scope fit on one screen; every scope call he must make is an Open Question with options |
| **bl-designer** | every screen-worthy story, personas, states | each Must story implies at least one screen or state; empty/error states are in the criteria |
| **bl-architect** | data that exists vs must be created, roles and permissions, integrations, volumes | Technical Considerations lists data sources, roles, third parties (Stripe, GHL, email/SMS), expected volumes |
| **bl-qa** | testable criteria with IDs | every Must story's criteria are tagged and pass/fail |

## 2. Technical literacy without designing the system

Surface what engineering needs to know; don't decide it.
- ✅ "Bookings must sync to the clinic's GHL calendar within 1 minute" (a requirement + an integration point)
- ❌ "Use a GHL webhook into a Supabase edge function" (that's the architect's call)

Always flag, as **Technical considerations**, when the PRD touches:
- **Money** (Stripe, refunds, taxes, currency) · **identity and roles** (who can see what, multi-tenant data) · **GHL** (which sub-account, which objects, standalone or embedded on a GHL marketing page; GHL is for websites and marketing, the Baseleap CRM owns customer data) · **AI/model output** · **personal data** (what's collected, retention) · **existing data** to migrate or import.

When a real technical unknown blocks a product decision ("can GHL's API even do X?"), don't guess — list it as an Open Question owned by the architect, and the orchestrator can schedule a spike.

## 3. Consistency sweep (before reporting)

- Every `FR-n` serves at least one story; every Must story is served by an FR.
- Every Non-goal is absent from the stories.
- Every metric's events exist in the event inventory.
- Story IDs, FR IDs and NG IDs are unique and referenced correctly.
- Nothing contradicts the intake decisions or the research record. If you deliberately depart from one, say so in the report.

## 4. Report — what the orchestrator turns into the Gate 1 packet

Use the `stack-specialist-protocol` report format, and add this section at the top so the orchestrator can build the scope packet without re-reading everything:

```markdown
## Gate 1 summary (≤ 9 lines)
- Problem: <one sentence>
- v1 in: <N Must / N Should / N Could stories — the spine in one line>
- v1 out: <top 3 non-goals>
- Success: <primary metric: baseline → target in window>
- Build mode: <from intake> — system of record: <…>; platforms: <name: role>
- Team profile hint: <static | frontend_baas | full_stack | backend_only> — <why>
- Decisions Matthew should make: <open questions, each with your recommendation>
- Risk: <the one thing most likely to sink v1>
```

Status values, exactly one of: **done** (all three docs written, self-critique passed; you have no shell, so the ledger runs `check-pm-docs` on verify, so don't invent a status like "done-unverified") · **needs-answers** (first pass; `docs/discovery-questions.md` written) · **blocked** (missing input you can't get; say what). A fix pass after a failed verify uses the same words: **done** when your edits are made (you still can't run the checker, so never "partial"). Name the report `.baseleap/reports/P0.md` and append one section per pass, headed `## Pass N`. Pass numbers are yours; the ledger counts failed attempts separately, so don't call a pass an "attempt".

---
Sources (ideas adapted, text written for Baseleap): product-on-purpose/pm-skills `develop-solution-brief`, `develop-spike-summary` (Apache-2.0 — bridging PM and engineering, spikes for unknowns), anthropics/knowledge-work-plugins `write-spec` (Apache-2.0). deanpeters `context-engineering-advisor` and `agent-orchestration-advisor` reviewed for ideas only (CC BY-NC-SA); jackreacher80/product-manager-skill (MIT) reviewed.
