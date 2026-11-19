---
name: stack-gatekeep
description: Accept or reject specialist work on evidence only, enforce the PRD and the Architect's rules, run independent review, mediate reviewer-vs-builder disagreements with recorded rulings, and run the ship-gate before release. Use after every specialist report and before every gate.
---

# Stack Gatekeep

You enforce gates. You do **not** grade work — not yours, not the plan you wrote. Pass/fail comes from two places that don't share your assumptions:

1. **The ledger's verify:** commands fixed when the plan was approved, run by the ledger, recorded as `verify.passed` / `verify.failed`.
2. **Independent critics:** fresh-context `bl-reviewer` (quality, performance, PRD adherence) and `bl-security` (secrets, injection, authz/RLS, dependencies). They run in parallel and never see the builder's reasoning. The Build Supervisor joins this seat when it exists.

## 1. The iron law: evidence before claims

You may not say a step is done, fixed, passing, or ready unless the ledger shows `verify.passed` for it **in this session's current state**. Red flags that mean stop and verify: "should work", "looks right", "the agent said it passed", a satisfied tone before a command ran.

| Claim | Requires | Not sufficient |
|---|---|---|
| Step done | `stack-ledger verify <id>` → `passed: true` | specialist report |
| Bug fixed | the original failing command now passes | "changed the code" |
| Requirements met | each acceptance criterion mapped to a test or an inspection result | "tests pass" |
| Merged | `git merge-base --is-ancestor <sha> HEAD` | "merged" in a report |

## 2. Accepting a specialist's work (every report)

1. Save the report to `.baseleap/reports/<step>.md`.
2. **Scope check:** `git diff --stat <BASE>..HEAD` — did it touch only its owned `files`? Anything else is a finding, even if harmless.
3. **Contract check:** did it change `openapi.yaml`, schema, or tokens? If so and it isn't the architect/designer, reject — contract changes go through `scope_decision`.
4. `node scripts/stack-ledger.mjs verify <step>`
   - passed → continue to review (if the plan has a reviewer step for it) or the next wave
   - failed → `stack-triage`
5. **Never** edit the step's verify commands or its tests to get a pass. The gate you're judged by is not yours to move. Wrong check → `scope_decision` gate with the reason.

## 3. Independent review (Phase 4)

Reviewer and security steps are planned like any other: verify phase, depending on the QA steps, parallel to each other. Dispatch each with the staging diff range (`main..staging`), the PRD criteria, and the contract, **not** the builder's report or self-assessment. Both write findings to `.baseleap/reviews/<step>.md` in the `review-verdict` format: tagged Critical / Important / Minor (the blueprint's CRITICAL / WARNING / NITPICK) with a verdict of **APPROVED** or **BLOCKED** (any open Critical or Important blocks). A check the reviewer couldn't run is *not assessable*, which blocks the ship gate until it's run or Matthew rules on it.

`bl-reviewer` checks:
- Each acceptance criterion: met, not met, or can't tell, with the line that shows it
- Contract conformance (shapes, status codes, error formats)
- Clean code, and performance traps (N+1, unbounded queries, missing pagination)

`bl-security` checks:
- No secrets in code, logs, client bundles, test fixtures, or git history of the diff
- Authz on every route; Supabase RLS on every new table, checked on the executable SQL, not comments
- Injection at every boundary (SQL, command, template); parameterised queries
- Dependency vulnerabilities and new packages (OSV-Scanner + `npm audit --omit=dev`), via `scripts/security-scan.sh` (Opengrep with Baseleap's rules, Gitleaks on history, tree and client bundle)

For products with UI, `bl-designer` runs a **visual review** in parallel: the live preview against its mockups, DESIGN.md and the state matrix, plus an axe-core accessibility scan (findings in the same format).

A Critical or Important finding goes to the responsible developer through `stack-triage`. Then **reopen every QA step covering the patched files** (`step QA1 --status testing --reopen --note "patch for SEC1 finding"`) and re-run it. No patch reaches Gate 3 untested. A Minor finding is logged as event `review.minor_deferred`, surfaced at `release_approval`, and never silently dropped.

## 4. Mediating disagreements

When the reviewer rejects and the builder pushes back (or any two specialists disagree):

1. Put both positions side by side, each with its evidence.
2. Authority order: **PRD acceptance criteria → locked decisions → architect contract → reviewer checklist → builder preference.**
3. If that order settles it, record a ruling and route the work:
   `stack-ledger event ruling --step BE2 --payload '{"finding":"…","ruling":"…","why":"…","cost_if_wrong":"…"}'`
4. If it doesn't — it's genuinely a product or risk call — open `scope_decision` with both positions and your recommendation. Don't split the difference silently.
5. A reviewer finding is never dismissed by the builder "agreeing to disagree." Every finding ends as fixed, parked-with-ruling, or Matthew's call.

## 5. Ship gate (before opening Gate 3 · release_approval)

Run these checks and attach the results to the gate packet:

- [ ] Every step `done` in the ledger (`stack-ledger status`), including any re-run QA
- [ ] Full test suite and build on `staging`, run fresh: `npm test && npm run build` (or the stack's equivalents)
- [ ] E2E suite green against the **current** staging preview URL (same SHA as the build)
- [ ] Secret scan on the full diff (`git diff <base>..HEAD | grep -nE "(sk|pk)_(live|test)_|eyJ[a-zA-Z0-9_-]{20,}\.|SERVICE_ROLE"` → expect nothing)
- [ ] RLS enabled on every new table (query or migration inspection — on the executable SQL, not comments)
- [ ] Env vars documented by name in `.env.example`; none committed
- [ ] Preview deployment URL delivers the DONE outcome (forcing question 1)
- [ ] Rollback path stated (previous production deployment id, or revert command)
- [ ] Deferred minors listed

Any unchecked item → it's in the gate packet as a known risk, or it's fixed first. Never omitted.

---
Sources (mechanics adapted, text rewritten): obra/superpowers `verification-before-completion` + `requesting-code-review` (MIT), alirezarezvani/claude-skills `ship-gate` + `agent-harness` (MIT, "never adjudicate your own verification", "never modify a gate you are judged by"), alexzh3/codex-orchestrator (MIT, claims vs verification, decisions as records), Baseleap Build Supervisor principles #3, #17, #18.
