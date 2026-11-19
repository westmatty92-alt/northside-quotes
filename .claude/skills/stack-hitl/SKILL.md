---
name: stack-hitl
description: Decide when the orchestrator must stop for Matthew, and how to ask — the fixed gates, the triggered gates, the gate packet format, and what to decide on your own. Use before any action involving money, scope, irreversibility, or credentials, and at every phase boundary.
---

# Stack HITL

Two failure modes, both expensive: asking about things you should just decide (Matthew's time), and deciding things that are his (his business). This skill draws the line.

## 1. Stops — you open a gate and wait

**Fixed gates** (every run, in order):
| Gate | Opens when | Matthew is approving | Typical time to decide |
|---|---|---|---|
| 1 · `scope_approval` | P0 verified (PRD, user stories, metrics spec pass `check-pm-docs`) | Is this the right thing to build? Stories, edge cases, what's out, team profile | ~1 minute |
| 2 · `contract_lock` | design + architecture verified and build plan submitted | The blueprint: design specs, schema + RLS, API contract, build waves and verify commands. After this, changing them costs a gate | ~5–10 minutes |
| 3 · `release_approval` | every step verified + ship gate run (new client builds: release and rollback drills passed, `docs/ops/pipeline-drills.md`; every build: `docs/sops/changelog.md` from bl-docs, with any ⚠ unverified steps listed) | Shipping: features done, test results, review and security findings, deferred minors, rollback path | ~2 minutes |

**Triggered gates** (whenever they apply):
| Gate | Trigger |
|---|---|
| `account_setup` | OPS-SETUP verified: Matthew must create or connect GitHub, Supabase and Vercel for this build. The packet is `docs/ops/account-setup.md`. Its gate summary lists the accounts, who owns them (decided at kickoff), and each recurring cost as a **DECISION** line (e.g. the second Supabase project's compute). Approving it covers those costs. Steps with `requires_gates: ["account_setup"]` are held until he approves |
| `spend_approval` | Any paid resource: new cloud service, plan upgrade, paid API, domain, usage likely to bill |
| `scope_decision` | Business logic the PRD doesn't settle; any change to a locked decision or the contract; adding/removing steps after approval (`plan --amend` opens it automatically) |
| `escalation` | The ledger opened it (loop / budget) — or you hit a credential/access boundary, or every path forward is a guess |

Also stop for anything **irreversible or outside the repo**: production data writes, destructive migrations on live data, DNS, pushing to `main`, sending email/SMS to real people. If it's not covered by an approved gate, it gets one.

## 2. Rulings — you decide, record, and keep going

Everything else is yours. Examples: naming, file layout inside an approved structure, which test framework flag, ordering inside a wave, which specialist owns an ambiguous failure, parking a Minor finding. Record consequential ones:
`stack-ledger event ruling --payload '{"ruling":"…","why":"…","cost_if_wrong":"…"}'`

A wrong ruling costs visible, undoable rework. A run parked on a question it didn't need to ask costs Matthew's day.

**Never bundle.** A scope or doctrine decision does not ride inside a routine approval. If the plan packet contains a decision Matthew might not notice ("this also switches auth providers"), it gets its own line marked **DECISION** — or its own gate.

## 3. The gate packet

For **Gate 2**, start from the architect's **Gate 2 summary** (≤ 8 lines: stack, tables, operations, notable decisions, risks, costs) and the designer's screen summary. Add:
- the ERD from `docs/architecture.md`, linked;
- the lane ownership, and the build plan's waves and verify commands;
- the A2 result (builds, RLS tests on the preview branch, mock serves the contract).

Each deviation from the house stack, each destructive or `both`-ways sync choice, and each recurring cost gets its own **DECISION** line. In platform_extension/hybrid, one bullet summarises the integration contract (system of record, what flows in and out, outage behaviour).

For **Gate 1**, start from the PM report's **Gate 1 summary** block (≤ 8 lines: problem, v1 in/out, success metric, team profile hint, decisions, risk); add the **build mode** (with its system of record and platform roles), the team profile you chose, and any spend. The build mode always gets its own **DECISION** line, because it decides who builds. Don't re-summarise the PRD yourself.

Write it to `.baseleap/gates/<key>-<n>.md`, then `stack-ledger gate open <key> --summary-file <path>`, then **stop** and show it to Matthew. Format — ≤ 12 lines above the fold:

```markdown
## 🔒 Gate 1 · scope_approval — Client portal v1
**Asking:** Is this the right thing to build?
**Recommendation:** Yes.

- Scope: 4 user stories (login, invoice list, invoice detail, pay). PDF export is v2
- Edge cases covered: expired session, unpaid vs partially paid, zero invoices
- **DECISION:** build mode `hybrid`. Our app holds the records; GHL keeps the website, forms and invoice emails
- Team: full_stack (custom invoice logic + auth), all nine roles
- **DECISION:** money stored as integer cents (affects Stripe + reporting)
- Spend: none until deploy (existing Vercel + Supabase)

**If yes:** the designer starts, then the architect. Next stop is Gate 2 (blueprint lock).
**If no:** tell me what to change; the PM revises the PRD and I re-ask.

<details: full step table, waves, verify commands, risks>
```

Then tell Matthew exactly how to answer, in his own terminal:
```
node scripts/stack-ledger.mjs gate resolve scope_approval --approve
node scripts/stack-ledger.mjs gate resolve scope_approval --reject --note "drop the pay story"
```
You cannot resolve gates — the CLI refuses inside Claude Code and the database refuses the service role. Don't try, and don't ask Matthew to paste a password into this session.

## 4. While waiting

Do only read-only prep that doesn't presume the answer (e.g. read docs the next wave will need). No dispatches — the hook blocks them anyway. When Matthew says it's resolved, confirm with `stack-ledger status` before moving on; a chat message saying "approved" is not the gate.

## 5. Rejected gates

A rejection is information, not failure. Record what changed and fix it (reopen the PM/designer/architect step with the note, or `plan --amend`), then open a **new** gate. Resolved gates are permanent history.

---
Sources (mechanics adapted, text rewritten): OneWave-AI/claude-skills `sub-agent-orchestrator` dry-run/approval mode (MIT), alexzh3/codex-orchestrator acceptance authority + `user_action_required` (MIT), obra/superpowers "rulings, not stalls" (MIT), Baseleap Build Supervisor principles #5, #7, #12.
