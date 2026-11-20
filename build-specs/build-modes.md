# Build modes: deciding what kind of build a client gets

**Status:** decided 2026-11-12 · enforced by `validatePlan` (ledger), `check-pm-docs` (PRD) and `stack-ledger plan` (PRD ↔ plan agreement)

Each client build answers one question first: **which system holds the customer records, and what does each platform do?** The answer sets the build mode. The mode decides who builds, which agents take part, and which contracts must exist before any code is written.

## The four modes

| Mode | System of record | Platforms | Who builds | Required before FE/BE work |
|---|---|---|---|---|
| `in_platform` | The client's CRM (GHL, Monday, HubSpot …) | That CRM, plus anything else they use | **CRM Automation** builds inside the platform. The dev team gives PM (PRD), designer (pages/forms) and QA/reviewer/security checks only | — (no architect, frontend, backend or devops steps; the ledger refuses them) |
| `platform_extension` | The client's CRM | That CRM | Dev team builds custom modules (portal, dashboard, calculator) that read and write the CRM through its API | `docs/integration-contract.md`, owned by an architect step |
| `hybrid` | **Our app** (Supabase) | GHL or another platform for website hosting, forms, email/SMS marketing | Dev team builds the core app; CRM Automation configures the marketing side | `docs/integration-contract.md`, owned by an architect step |
| `custom` | **Our app** | None | Dev team, end to end | Normal contract-first rule only |

**Platforms other than GHL** (Matthew, Nov 19 2026). GHL is the only platform with built-in automation know-how. A client on Salesforce, HubSpot or Monday is still accommodated: at kickoff Matthew downloads that platform's workflow, trigger and action documentation and it is fed to the agent doing the platform work (CRM Automation for `in_platform`; `bl-integration` for the app's side of `platform_extension`/`hybrid`). No standing skills for those platforms; the doc pack lives with the client's build. The app connects through the vendor's official API or connector, never a third-party server with write access to the client's live CRM. n8n/Zapier/Make stay out of new builds (`int-providers` rule 5).

Baseleap's own default for new clients is `hybrid`: we build the dashboard and CRM, and GHL handles websites, forms and email marketing. Moravian is `hybrid` today. The Baseleap dashboard itself is `custom`.

## The decision tree (asked at intake, one question per turn)

```
Q1  Does the client already run their business on a CRM they want to keep
    as the main system (GHL, Monday, HubSpot …)?
    ├─ yes → Q2  Can that CRM's own features (pipelines, custom objects, automations,
    │            forms, dashboards) cover what they need?
    │            ├─ yes → in_platform
    │            └─ no, they need screens or logic it can't do → platform_extension
    └─ no (or they want off it) → Q3  Will a platform still run the website, forms
                                      or email/SMS marketing?
                                      ├─ yes → hybrid
                                      └─ no → custom
```

Things that push a client one way or the other. Record each one you used as part of the reason.

- **Budget and timeline:** `in_platform` is the cheapest and fastest; `custom` is the most expensive.
- **Data ownership:** if the client wants to own their data or leave a platform later, that points to `hybrid` or `custom`.
- **Platform limits:** record limits, permission granularity, reporting, or a client portal the platform can't do. These push towards `platform_extension` or `hybrid`.
- **Compliance:** for example, no SMS for cannabis, or PII rules. These can rule a platform out of a role.
- **Who uses it:** staff who already live in the CRM point to `in_platform` or `platform_extension`. Customers or wholesale buyers who need a portal point to `platform_extension` or higher.
- **Signals from the Console:** the client's `current_stack` and `research_brief` (from `stack-ledger client-brief`).

If the answers conflict, ask Matthew. The mode is a scope decision, not a technical detail.

## Three ways a build starts

| Start | How | Build mode comes from |
|---|---|---|
| **Client with existing systems** | Audit call in the Console → client record | The audit's Build mode card (confirmed at intake) |
| **Client starting from scratch** (no CRM, no website yet) | Audit call. Q1 has a third answer, "Nothing yet, starting from scratch" (`starting_fresh: true`) | The audit card. The answer leads to Q3, so the mode is `hybrid` or `custom` |
| **New build** (our own product or venture: the Baseleap dashboard, a SaaS idea, a wholesale system with no client yet) | `stack-ledger init --new "<name>"`. This creates a Console record with `status: venture` (because `build_plans.client_id` is required) | The orchestrator asks Q1–Q3 in full at intake. The PM's market check is required, because there's no research record |

All three use the same modes, gates and plan rules afterwards.

## Where the mode is recorded

0. **Audit call (mandatory):** Matthew asks Q1–Q3 and a "why" in the Console Audit Assistant (Guide tab → **Build mode** card). The Console derives the mode and saves it to `clients.current_stack.build_decision`. Gaps can't be saved to the client without it. `stack-ledger client-brief` carries it into `.baseleap/inputs/client-research.md`.
1. **Intake:** the orchestrator reads that record and asks Matthew to confirm it as forcing question 7 (`stack-decompose` §1). It asks the questions itself only if there is no record. Either way, it records a `decision` event with the mode and reason.
2. **PRD:** the PM copies the mode into the PRD frontmatter (`build_mode:`). Technical Considerations must state **System of record** and **Platform roles**. `check-pm-docs` fails without them. The PM never picks the mode. If discovery contradicts it, the PM raises it as an open question.
3. **Gate 1:** the scope_approval packet states the mode in its first lines, so Matthew approves it along with the scope.
4. **Plan:** the first plan submission carries `build_mode`, `build_mode_reason`, `system_of_record` and `platforms: [{ name, role }]`. The ledger stores them on the plan, and every later submission is checked against them. `stack-ledger plan` refuses a plan whose mode disagrees with `docs/PRD.md`.
5. **Changing mode** after Gate 1 is a `scope_decision` and needs Matthew. It is never done by editing a plan.

## What each mode changes in the plan

- **`in_platform`:** the plan may contain pm, designer, qa, reviewer and security steps only. The platform build itself (pipelines, custom fields, workflows, forms) is CRM Automation's work on the Console Builds tab (track `automation`). QA tests the finished flows end to end inside the platform.
- **`platform_extension`:** the architect writes `docs/integration-contract.md` before any frontend or backend step. It covers:
  - which platform objects we read and write;
  - auth to the platform API;
  - rate limits;
  - webhooks in;
  - what happens when the platform is down.
  
  We never duplicate the system of record. Our tables hold only what the platform can't.
- **`hybrid`:** the same integration contract, the other way round. It covers:
  - which events the app pushes to the platform (contacts and tags that trigger email/SMS marketing). **Pipelines, deal stages and
    reporting live in our app** (Matthew, Nov 19 2026): a stage change pushes a tag such as `quote-won`, and the platform's workflow
    reacts to the tag. Never mirror pipelines or opportunities into GHL unless the client explicitly asks and Matthew approves;
  - what the platform sends back (form submissions, unsubscribes);
  - field mapping;
  - which side wins on conflict (always the app).
- **`custom`:** no extra contract. The usual contract-first rule still applies (every FE/BE step depends on an architect step).

## Open items

- **Track bridge:** for `in_platform` work, the orchestrator can't yet create `automation`-track steps itself. For now it hands the approved PRD to CRM Automation through the Builds tab. A `stack-ledger handoff --to automation` command comes with the Builds tab work.
- **New platforms (decided):** when a client runs Monday or HubSpot, Matthew uploads that platform's action and trigger documentation to the CRM Automation agent. The dev team builds no separate skills for them. For `platform_extension`, the architect reads the same docs for the integration contract.
