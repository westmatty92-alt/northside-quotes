---
name: stack-triage
description: Diagnose a failed verify, test, review finding or broken build to its root cause, route the fix to the right specialist, and run the bounded fix loop with loop detection and escalation. Use whenever `stack-ledger verify` fails, QA or the reviewer reports a problem, or a specialist reports it's stuck.
---

# Stack Triage

No fix gets routed until you can state the root cause in one sentence. Symptom-patching is how agents end up retrying the same broken fix three times.

## 1. Root cause before routing

1. **Read the whole error.** Exact message, file, line, the command that failed, its exit code.
2. **Reproduce.** Re-run the failing verify command. Not reproducible → it's `flaky` or `env`; gather evidence, don't guess.
3. **Diff the boundary.** In multi-layer failures, find which side of which boundary the data went wrong on — request vs contract, contract vs handler, handler vs DB. Check what changed (`git log -p` on the step's files since the last passing verify).
4. **Write the signature** — the one line that names the root cause, e.g.
   `contract: FE sends amount as string "12.50"; openapi.yaml says integer cents`
   Not the symptom (`422 on submit`).

## 2. Classify and route

| Class | Meaning | Route to |
|---|---|---|
| `contract` | One side diverged from `openapi.yaml`/schema | The side that diverged. If the contract itself is wrong → architect + `scope_decision` gate |
| `impl` | Code doesn't meet an acceptance criterion | The step's owner |
| `test` | Test is wrong, brittle, or tests the wrong thing | **qa** — never let the builder edit the test it's judged by |
| `env` | Missing env var, config, dependency, permission | devops; credentials → escalation (never improvise around an access boundary) |
| `spec` | PRD is ambiguous or contradicts itself | pm proposes, Matthew decides (`scope_decision`) |
| `flaky` | Passes and fails on identical input | qa to stabilize; never "retry until green" |

## 3. Record it — the ledger does loop detection

```
node scripts/stack-ledger.mjs fail BE2 \
  --signature "contract: FE sends amount as string; contract says integer cents" \
  --class contract --route-to bl-frontend --summary "422 on invoice create"
```

- Exit 0 → it prints the round and the rule for it. Follow it.
- **Exit 2 means an escalation gate is open and all dispatch is paused.** The same root cause twice in a row is a loop. A third failed attempt trips the breaker. Stop and brief Matthew (`stack-hitl`). Don't try to route around it; the hook will block you anyway.

## 4. The fix loop (3 attempts per step)

| Attempt | Who | Brief carries |
|---|---|---|
| 1 | The step's specialist (the original dispatch) | the normal brief |
| 2 | The **same** specialist, resumed (SendMessage to its name if still live, else fresh with the report file) | Root-cause signature, the failing file plus the trimmed trace (nothing else), **and a required change of approach**: "the previous approach was X; do not repeat it" |
| 3 (last) | A **fresh** specialist, one model tier up | "A prior implementer tried twice; you own it now. Read `.baseleap/reports/<step>.md` for everything that was tried." |

QA's error log is the input. QA saves it to `.baseleap/reports/<QA step>-errors.md`. You read it, decide UI bug vs server bug vs contract vs test, and send the owner **only the failing file(s) and the relevant trace**, never the whole log or the whole codebase.

Every round: specialist fixes → runs the covering test itself → appends to the report file → you run `stack-ledger verify <step>`. Only the ledger's verify closes the round.

**Retry means a changed approach.** Same input + same command = same failure. If you can't say what's different this round, you're about to loop — escalate instead.

## 5. When review and builder disagree (and other deadlocks)

See `stack-gatekeep` §4 — mediation and rulings live there. Triage only decides *what's broken and whose it is*.

## 6. Escalation brief (when the ledger exits 2)

```
⛔ ESCALATION — <step id> <title>
Root cause (best current understanding): <signature>
Tried: 1) <approach> → <result>  2) … (from the report file)
Why I'm not retrying: <loop | budget | access boundary | spec gap>
Options:
  A) <recommended> — <cost/risk>
  B) <alternative> — <cost/risk>
  C) Park the step and continue the rest of the plan (if nothing downstream depends on it)
Decide with: `node scripts/stack-ledger.mjs gate resolve escalation --approve --note "A"` (your terminal)
```

---
Sources (mechanics adapted, text rewritten): obra/superpowers `systematic-debugging` + `subagent-driven-development/references/fix-loop.md` (MIT, root-cause-first, 5-round loop, fresh-eyes escalation), mattpocock/skills `triage` (MIT, classify-verify-brief), alirezarezvani/claude-skills `agent-harness` (MIT, retry = changed approach, budgets as terminal states).
