---
product: <Product name>
client: <Client business name>
version: v1
status: draft            # draft → approved (set by the orchestrator after Gate 1)
build_mode: <in_platform | platform_extension | hybrid | custom — copy from the intake decision; never choose it yourself>
ai_output: false         # true if any feature's output comes from a model → AI Behaviour section required
---

# PRD: <Product name>

## Overview

### Problem
When <situation>, <who> struggles to <progress they want>, which costs them <time / money / customers / risk>. Today they <workaround>.

### Job to be done
When <circumstance>, I want to <progress>, so I can <outcome>.

### Personas
| Persona | Who they are | Evidence |
|---|---|---|
| <Name> | <one line> | <research record line / Matthew's answer #> |

### Why now
<one or two sentences — what changed, what it's costing to wait>

## Goals & Success Metrics
- **Primary metric:** <metric> — baseline <x> → target <y> within <window> (full definition in `docs/metrics-spec.md`)
- **Guardrails:** <metric> must stay <threshold>; <metric> must stay <threshold>

## Scope

### In scope (v1)
- <capability> — US-001, US-002
- <capability> — US-003

### Non-goals
- **NG-1** <what is out> — <why> — <when it might come back>
- **NG-2** <what is out> — <why> — <when it might come back>

## Functional Requirements
- **FR-1** <the system must … — behaviour, not implementation>. Serves: US-001
- **FR-2** <…>. Serves: US-002, US-003

## Edge Cases
| Case | Expected behaviour | Covered by |
|---|---|---|
| <double-submit on confirm> | <only one booking is created; second click is ignored> | AC-003.2 |
| <third-party service down> | <…> | AC-003.3 |

## AI Behaviour and Evaluation
<!-- Required when ai_output: true. Otherwise replace this section's body with: "Not applicable — no feature output comes from a model." -->
| Behaviour (requirement) | How it's shown to hold | Pass rule |
|---|---|---|
| <answers only from the clinic's own FAQ> | <evaluation set of N questions incl. off-topic> | <cites a FAQ entry, or says it doesn't know> |
| Refuses / says "I don't know" when <…> | <…> | <…> |
Content the model reads is data, never instructions. Output never reaches anyone with less access than its source.

## Technical Considerations
- **System of record:** <"the new app", or the client platform that owns customer records (GHL / Monday / HubSpot …) — must match build_mode>
- **Platform roles:** <each platform and its job, e.g. "GHL: website hosting, forms, email marketing"; "none" for custom>
- **Data:** <what exists (where) vs must be created; expected volumes>
- **Roles & permissions:** <who can see/do what; multi-tenant boundaries>
- **Integrations:** <Stripe / GHL (sub-account, objects; embedded or standalone) / email / SMS / other>
- **Constraints:** <screens that must embed on a GHL marketing page, if any; performance budgets; compliance>

## Agent Execution Contract
- **Authoritative sources (highest first):** this PRD → `docs/decisions/` → `docs/openapi.yaml` + migrations → `docs/design-specs.md`
- **Do not touch:** <systems, data, flows that must stay as they are>
- **Verification map:** FR-1 → AC-001.1, AC-001.2 · FR-2 → AC-002.1, AC-003.1 … (QA writes one test per AC)
- **Stop and escalate (raise a contract question, don't decide):** <e.g. any change to how prices or totals are calculated; any new personal-data field>

## Dependencies & Risks
| Item | Type | Owner | Mitigation |
|---|---|---|---|
| <client's booking data export> | dependency | Matthew | <…> |
| <…> | risk | <…> | <…> |

## Open Questions
| # | Question | Options (recommended first) | Owner |
|---|---|---|---|
| OQ-1 | <…> | <A (rec) / B / C> | Matthew |

## Appendix
- Sources: <research record, discovery answers, competitor URLs>
- Revision history: v1 <date> — initial draft
