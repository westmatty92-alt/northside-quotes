---
name: stack-route
description: Match each ledger step to the right dev-team specialist, model tier and file lane, and write the dispatch brief. Use every time the orchestrator is about to call a bl-* agent.
---

# Stack Route

Every dispatch is one ledger step → one specialist, with a brief that stands on its own. The gate-guard hook blocks a dispatch that doesn't name its step, so routing mistakes surface as denials — read the reason, don't retry blindly.

## 1. Capability matrix

| Agent | Owns | Never does | Default model |
|---|---|---|---|
| `bl-pm` | `docs/PRD.md`, `docs/user-stories.md`, `docs/metrics-spec.md` (+ `docs/discovery-questions.md` on a first pass). Scope calls *proposed* to Matthew | code, architecture, screens | sonnet |
| `bl-designer` | `DESIGN.md` brand contract, `docs/user-flows.md` (inventory, data needs, flows), `docs/design-specs.md` (screens, components, states), token-only mockups + screenshots; **post-build visual review** of the staging preview (verify phase) | production components; fixing what it reviews | sonnet (opus when creating a brand from scratch) |
| `bl-integration` | provider wrappers, webhooks, sync jobs, OAuth, outage behaviour, provider simulators for QA, the integrations registry and runbooks (takeover first on existing projects) | the integration contract itself (architect), business rules (backend), configuration inside GHL (CRM Automation) | sonnet |
| `bl-architect` | **A1 blueprint:** decision records in `docs/decisions/`, `docs/architecture.md`, `docs/SECURITY_MODEL.md`, `supabase/migrations/*.sql` with RLS + RLS tests, `docs/openapi.yaml`, and `docs/integration-contract.md` in platform_extension/hybrid · **A2 scaffold** that builds · contract questions and amendments · spikes | feature code | opus |
| `bl-backend` | migrations applied in order, endpoints, business logic, auth, integrations, server tests | UI, changing the contract | sonnet |
| `bl-frontend` | UI components, client state, API integration *against the locked contract* (mocks until the backend lands), responsive/a11y, Playwright visual checks | migrations, server logic, changing the contract | sonnet |
| `bl-devops` | Vercel preview env for `staging`, env var *names*, CI, production promotion, health check. Docker/IaC only for non-Vercel targets | app logic | sonnet |
| `bl-qa` | unit/integration tests, Playwright E2E against the preview URL, error logs, regression re-runs | fixing product code | sonnet (haiku for pure re-runs) |
| `bl-reviewer` | code quality, performance, adherence to PRD + contract | writing the fix; security verdicts | sonnet (opus for large diffs) |
| `bl-security` | exposed secrets, injection, broken authz/RLS, dependency vulns | writing the fix | opus |

Routing heuristics when a failure or request is ambiguous:
- DB migration, RLS, server error, wrong status code → **backend**
- Render bug, animation, layout, client validation, hydration → **frontend**
- Request/response shape disagreement → **architect** first (the contract is the authority), then whichever side diverged
- Flaky or wrong test → **qa** (never let the builder weaken its own test)
- Secret, injection, auth bypass, RLS gap → **security** finds it; the owning developer fixes it
- Built UI doesn't match the design, broken mobile layout, contrast failure → **designer** visual review finds it; **frontend** fixes it
- Env/secret/build pipeline → **devops**
- "Should it even do this?" → **pm** proposes, Matthew decides (`scope_decision`)

If a needed specialist's file doesn't exist in `.claude/agents/`, **stop** — say which role is missing. Never do its work yourself and never substitute `general-purpose`.

## 2. Model tier

- Turn count beats token price. Cheapest tier only when the brief contains everything (mechanical, 1–2 files, complete spec).
- Multi-file integration or debugging → sonnet. Architecture, security review, fix-loop rounds 4–5 → opus.
- Always pass `model` explicitly — an omitted model inherits the orchestrator's (most expensive) model.

## 3. Parallel lanes (worktrees)

- Parallelize steps in the same ready wave **only** when their `files` don't overlap. The ledger already rejected same-wave clashes; respect it at dispatch time too.
- Phase 2 has three standing lanes: `wt-backend`, `wt-frontend`, and devops in the main tree (config only). Create each lane once (`git worktree add ../<repo>-wt-backend -b lane/backend staging`) and give every step in that lane the lane path in its brief, so consecutive steps build on each other.
- Within a lane, steps run one at a time. Across lanes, they run in parallel (`run_in_background: true`).
- Lane count is the number of independent file groups, not the number of steps. The ledger rejects same-wave file overlaps at plan time.
- **Phase 3 merge:** merge `lane/backend`, then `lane/frontend`, into `staging` and push. That triggers the Vercel preview. Record the merge SHAs and the preview URL as an event (`event integration.merged`). Conflicts go back to the owning lane; you never resolve them yourself.

## 4. The dispatch brief

The first line is mandatory and machine-read by the hook. Keep it self-contained — the specialist has none of your conversation.

```
STEP: BE2

## Task
POST /api/invoices — <ledger step title>

## Behaviour required
<step description — what, not how>

## Acceptance criteria (each independently checked)
- 401 without a session
- 422 when amount is not a positive integer (cents)
- row visible only to its operator (RLS)

## Out of scope
- PDF rendering

## Context packet (read these, nothing else unless needed)
- openapi.yaml#/paths/~1api~1invoices      ← the contract; do not change it
- supabase/migrations/20261111_invoices.sql
- docs/decisions/0003-money-in-cents.md     ← locked decision

## You own these files (edit nothing else)
src/app/api/invoices/route.ts, src/app/api/invoices/route.test.ts

## Done means
`npm test -- src/app/api/invoices` exits 0. The ledger runs it — not you, not me.

## Report back (≤15 lines)
Write the full report to .baseleap/reports/BE2.md and return only its summary:
files changed · what each acceptance criterion maps to · commands you ran + results ·
anything you could NOT do and why · CONTRACT QUESTION (if any — don't work around it).
```

If the hook refuses a dispatch after you marked the step building, put it back: `step BE2 --status queued --note "<the refusal>"` and log `event dispatch.denied`.

After dispatch: `node scripts/stack-ledger.mjs step BE2 --status building` (this records the step's checkout and base commit; `verify` later fails the step if its `STEP BE2:` commits touch files it doesn't own). When the report returns, read `.baseleap/reports/BE2.md` (files carry history, not your context), then run `verify` (see `stack-gatekeep`).

## 5. The PM's two passes (P0)

Before dispatching P0: write `.baseleap/inputs/intake.md` (your intake decisions) and `node scripts/stack-ledger.mjs client-brief --client <uuid>` (for a client it exports the research record; for a new build it writes a short note saying there is none). Both go in the context packet.

**Never tell the PM to skip its questions** ("write assumptions instead of asking", "don't stop to ask"). Its no-invention rule is what makes the PRD trustworthy. Pass on what intake settled; leave the rest to its two passes.

The PM may answer a first dispatch with **status `needs-answers`** and `docs/discovery-questions.md` (5–7 lettered-option questions, each with a recommendation). That is the protocol working, not a failure:
1. **Don't record a `fail`** and don't count an attempt.
2. Ask Matthew the questions as multiple-choice prompts (≤ 4 per prompt; two prompts for 7), showing the PM's recommendation first. "Other" stays open.
3. Record each answer: `stack-ledger event decision --step P0 --payload '{"q":"…","a":"…","by":"matthew"}'`.
4. Write `.baseleap/inputs/discovery-answers.md` (question → answer, numbered as in the PM's file) and **re-dispatch P0 to the same agent** with it added to the packet.
5. On the second pass the PM writes the three docs. **The PM has no shell, so you commit its work:** `stack-ledger commit P0` (stages only P0's owned files and its report, as `STEP P0: …`). Then `stack-ledger verify P0` runs `scripts/check-pm-docs.mjs` and the ownership check. A verify failure **is** a normal failure (fix loop, 3 attempts).

A PM that returns `needs-answers` twice for the same unknowns is blocked: open an `escalation` with what's missing.

## 5b. The designer's brand pass (D1)

Before dispatching the design step, export the brand source for it: `stack-ledger client-brief --client <uuid>` (its `current_stack.brand_source` says files / website / brand_agent / placeholder) and, when the source is files, `stack-ledger client-assets --client <uuid>` (copies the uploads into `.baseleap/inputs/brand/`). Put both in the packet.

The designer may answer with **needs-answers**, and that's the protocol working, exactly as with the PM:
- **No brand recorded:** its report's `## Brand questions` offers A) uploads, B) draft from the website, C) Marketing's Brand agent, D) the neutral placeholder. Ask Matthew as a multiple-choice prompt, recommendation first. **D is Matthew's decision only.** Never pick it for him, and never tell the designer to "use something neutral" yourself.
- **Website draft:** it returns a brand board screenshot (`docs/design/screens/SCR-00-*.png`) and asks Matthew to confirm the palette and type. Show him the screenshot and the contrast fixes it lists.
- **Brand agent not finished:** wait (the step stays building), or start on the placeholder if Matthew says so.

Record each answer as a `decision` event, write `.baseleap/inputs/brand-answers.md`, and re-dispatch D1. Don't record a `fail` and don't count an attempt. If Matthew picks A, tell him which Console record to upload to, then run `client-assets` again before re-dispatching.

The design step's verify is `npx --yes @google/design.md lint DESIGN.md` and `node scripts/check-design.mjs`. Running `node scripts/render-mockups.mjs` is the designer's job, not yours. The designer has a shell, so it commits its own work as `STEP D1:`.

## 6. Contract questions — specialists never talk to each other

When a report contains a **CONTRACT QUESTION** (the front-end needs a field the contract lacks, the backend finds the schema can't express a rule):

1. Log it: `stack-ledger event contract.question --step FE2 --payload '{"question":"…","raised_by":"frontend"}'`
2. **Before contract_lock:** reopen the architect step (`step A1 --status building --reopen --note "<question>"`) and dispatch `bl-architect` with the question. The answer lands in the contract, and the asking step resumes against the updated file.
3. **After contract_lock:** don't patch around it. Add an architect amendment step (`plan --amend`, which opens `scope_decision`) with the question and the architect's recommended change. Matthew approves before anything builds on it.
4. Meanwhile, the asking specialist's step stays `building`. It may continue on parts the question doesn't touch, and it must not invent the missing piece.

---
Sources (mechanics adapted, text rewritten): OneWave-AI/claude-skills `sub-agent-orchestrator` (MIT, routing patterns), codingagentsystem/cas supervisor (MIT, lane-based worker count), obra/superpowers `subagent-driven-development` (MIT, model selection, isolated context), mattpocock/skills AGENT-BRIEF (MIT, brief template).
