---
name: qa-plan
description: Test planning for bl-qa — turn the PRD's acceptance criteria and Given/When/Then stories into docs/test-plan.md, a risk-ranked matrix that maps every criterion to the black-box test that proves it (E2E flow, API check, permission probe or fuzz), with boundaries, smoke vs regression tags and test data. Use first on every project, and again whenever the PRD or contract is amended.
---

# QA · Acceptance Criteria → Test Plan

The test plan is the promise: every acceptance criterion in the PRD has a named test that proves it on the deployed app. If a criterion has no test, nobody has checked it.

## 0. Existing projects: test takeover first
On a project that already exists, before writing anything, list what's there: every test suite and how it runs (unit, SQL harnesses, Playwright, manual checklists, a reviewer's routine checks), which pass today (run them read-only where the project allows, or read the latest recorded results), and which roadmap items or flows have **no** test. Output `docs/qa-reports/test-takeover.md`: suites, last known result, gaps ranked by risk (money, orders, personal data, access first). New tests follow the project's existing layout and rules.

## 1. Inputs

- `docs/PRD.md` (FRs, NFRs, out-of-scope) and `docs/user-stories.md` (AC ids like `AC-003.2`, tagged `[happy]`, `[edge]`, `[error]`).
- `docs/user-flows.md` (screens, access: app or GHL embed), `docs/openapi.yaml` (operations), `docs/SECURITY_MODEL.md` (roles, permission matrix).
- `docs/metrics-spec.md` for events that must fire.

## 2. Build the matrix (`templates/test-plan.md`)

One row per acceptance criterion:

| Column | Rule |
|---|---|
| AC id | exactly as in `user-stories.md` |
| Risk | **H** money, auth/permissions, data loss, anything a client's customer sees break · **M** core flow, wrong but recoverable · **L** cosmetic, rare path |
| Level | `e2e` (browser flow) · `api` (black-box request to the deployed API) · `probe` (permission boundary) · `fuzz` (covered by the schema fuzz run) — pick the cheapest level that truly proves the criterion; a UI-visible outcome needs `e2e` |
| Test | file + test name, e.g. `tests/e2e/booking.spec.ts › AC-003.2 slot taken shows next 3 slots` |
| Tag | `@smoke` (the handful of H-risk happy paths that must pass on every deploy) or `@regression` |
| Data | which seeded role/tenant and records it needs |

Plus, under the matrix:
- **Boundaries** per input the PRD constrains (min, max, just outside, empty, wrong type, unicode, very long) — these feed the `api` tests and confirm the fuzz run covers them.
- **Permission rows** — one per role × protected operation from the security model's matrix (allowed / 403 / cross-tenant 404).
- **NFR checks** — performance budgets, accessibility (axe on every screen), embed in a GHL-sized iframe, analytics events.
- **Not tested, and why** — anything deliberately left out (out of scope, manual-only). Empty is fine; silent gaps aren't.

## 3. Rules

- Test what the PRD says, not what the code does. Don't read `src/` to decide what "correct" is.
- An ambiguous or untestable criterion ("should be fast", "easy to use") is a **spec** question for the orchestrator — propose a measurable version; don't invent the threshold.
- H-risk criteria get at least one `[error]`/`[edge]` test besides the happy path.
- Keep the smoke set small (≈5–10 tests, under 3 minutes) so it can gate every deploy.

## 4. When to write it

You're dispatched for the plan right after **Gate 2 · contract_lock**, in parallel with the build lanes — the plan and the specs are written from the PRD, flows and contract while the code is being built, so they can't be shaped by the implementation. Phase 3 runs them. When the PRD or contract is amended (`plan --amend`), update the affected rows and say so in your report.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills `senior-qa` (MIT — test structure, coverage gaps; the blueprint's `qa-test-planner` doesn't exist in that repo), VoltAgent `qa-expert` (MIT — risk assessment, exit criteria), qodo-ai/pr-agent (MIT — reviewed; mapping tests to requirements. Its test generation is in Qodo's paid product, not the open-source agent).
