---
name: stack-context
description: Keep the orchestrator and every specialist on minimal, correct context — per-role context packets, the ledger as single source of truth, locked decisions, and resume-after-compaction. Use at session start, before every dispatch, and whenever you're unsure what state the build is in.
---

# Stack Context

Two jobs: give each specialist exactly what its step needs, and never let *your* memory outrank the ledger.

## 1. Source-of-truth order

When two sources disagree, the higher one wins:

1. **Repository state** (git HEAD, files on disk) — what was actually delivered
2. **Ledger** (`stack-ledger status`, `stack_events`) — what was planned, approved, verified
3. **Locked decisions** (`docs/decisions/*.md`, `decision` events) — what's settled
4. **Specialist reports** (`.baseleap/reports/<step>.md`) — claims, not facts
5. **Your conversation memory** — the least reliable; it does not survive compaction

A report saying "tests pass" is a claim. `verify.passed` in the ledger is a fact.

## 2. Session start / after compaction (always)

```
node scripts/stack-ledger.mjs status
git log --oneline -15 && git status --short
ls .baseleap/reports/ docs/decisions/ 2>/dev/null
```

Then: re-read PLAN.md, PRD.md, and any decision files touched by the `ready` steps. Never re-dispatch a step the ledger shows `done`. If a step is `building` with no report file, ask its status from git (`git log -- <owned files>`) before assuming it never ran.

## 3. Context packets — slice, don't dump

Never paste the codebase. Hand over **paths**, not contents; the specialist reads what it needs. Put the packet list in the step's `context` field at plan time so it's reviewed at Gate 2 (contract_lock).

| Role | Always gets | Add when relevant | Never gets |
|---|---|---|---|
| pm | brief, intake decisions | competitor/reference links | code |
| designer | docs/PRD.md (stories), brand tokens / DESIGN.md | reference screens | DB schema |
| architect | docs/PRD.md, docs/user-flows.md, docs/design-specs.md, decisions, existing migrations, repo tree | Supabase RLS conventions, integration docs | — |
| backend | contract slice, migrations, decisions, lane worktree path, its owned files | integration API docs | design files |
| frontend | contract slice (the paths it calls), docs/user-flows.md, docs/design-specs.md, the screen's mockups, lane worktree path, its owned files | Playwright selectors, the BE step's report once integrating | migrations, server code |
| devops | env var **names**, deploy target, CI conventions, branch names | build logs | secret **values** |
| qa | PRD acceptance criteria for the flows under test, contract slice, staging preview URL, test conventions | failing step's report | permission to edit product code |
| reviewer | staging diff range (`main..staging`), PRD criteria, contract | prior review findings | the builder's self-assessment (review the code, not the claim) |
| designer (visual review) | staging preview URL, docs/user-flows.md, its mockups + screenshots, DESIGN.md, frontend diff range | seed/test account name | the frontend's report |
| security | staging diff range, migrations (RLS), env var names, dependency manifest | prior security findings | secret values; the builder's self-assessment |

Failure context is the narrowest slice that reproduces: the exact error, the failing command, the relevant 20–60 lines of trace, the contract excerpt — not the whole log.

## 4. Locked decisions register

A decision is locked when Matthew approved it at a gate or answered a forcing question. Each lives in `docs/decisions/NNNN-<slug>.md`:

```markdown
# 0003 — Money is stored as integer cents
Status: locked (contract_lock, 2026-11-12, Matthew)
Context: …  Decision: …  Consequences: …  Supersedes: —
```

Rules: specialists treat locked decisions as constraints. Changing one is a `scope_decision` gate, never a dispatch-time tweak. A specialist report that contradicts a locked decision is a finding to triage, not a new decision.

## 5. Keep your own context clean

- Write every report, review package, and long log to a file and pass the path. What enters your context stays there.
- One-line narration between tool calls. The ledger and the task list carry the record.
- Don't fix things yourself "because it's quick" — controller fixes skip review and pollute the coordinator.

---
Sources (mechanics adapted, text rewritten): obra/superpowers `subagent-driven-development` (MIT, ledger-over-memory, files not context), alexzh3/codex-orchestrator orchestration contract (MIT, record authority), codingagentsystem/cas (MIT, memory tiers), FlorianBruniaux/claude-code-ultimate-guide task-management workflow (CC BY-SA 4.0 — concepts only, no text reused).
