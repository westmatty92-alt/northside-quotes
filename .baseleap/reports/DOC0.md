# STEP DOC0 — SOP plan for what this build creates or changes
## Attempt 1 — 2026-11-19
**Status:** done
**Files changed:**
- `docs/sops/plan.md` — new: 11 procedure rows (3 kind 5, 8 kind 2), "Not documented" list, 8 open questions for Gate 2
- `.baseleap/reports/DOC0.md` — this report

**Read:** `docs/PRD.md`, `docs/design-specs.md`, `docs/user-flows.md`, `docs/architecture.md`, `docs/integration-contract.md`, `docs/SECURITY_MODEL.md`, `docs/ops/account-setup.md`, `docs/metrics-spec.md`, `PLAN.md`, `.baseleap/plan-blueprint.json` (the DOC0 entry), `.baseleap/reports/A1.md`, `scripts/sop-check.mjs`, the docs-sop and docs-plan templates.

**Summary for the Gate 2 packet (3 lines):**
1. The plan lists 11 procedures: 3 for the owner and helper (work the inbox list, move cards on the board, what to do when a GoHighLevel copy or stage tag shows "failed") and 8 for Baseleap (recover failed syncs, add and remove a staff account, release, rollback, 24-month purge, delete one person's data, rotate app secrets). Nothing is written or built yet.
2. Staff SOPs have no home yet: no plan names the client's docs location. Suggested: keep them in this repo under `docs/sops/client-staff/` for the rehearsal.
3. Matthew needs to decide: how staff get a first password and who resets a forgotten one (no email), whether production releases use a Supabase access token (account-setup Part 7) or only the database connection string (his Nov 18 rule), and whether the drills will cover a rollback and one secret rotation.

**Acceptance criteria:**
- One row per procedure with who runs it, kind, home and expected evidence → table in `docs/sops/plan.md` (11 rows, all six columns filled)
- No procedure is described as built → intro states it is a plan; evidence cells say what "will" or "to be" back each row; no past-tense claims about the build
- No template placeholders remain → `grep -c -F` for the double-brace marker returns 0

**Commands run:**
- `test -s docs/sops/plan.md` → exit 0
- `grep -c -F '{{' docs/sops/plan.md` → 0 matches (so the ledger's `! grep -n '{{'` check passes)
- `grep -qi '| *procedure' docs/sops/plan.md` → exit 0
- `node scripts/sop-check.mjs docs/sops` → exit 0, "0 SOP(s), 0 error(s), 0 unverified step(s)" (plan.md is skipped by the checker, as designed; there are no SOPs yet)

**Judgement calls (where I departed from the brief's candidate list):**
- Split "release and rollback runbook" into two rows (release, rollback): a wrong step during a rollback costs data, so it needs its own page.
- Split "adding or removing a staff account" into two rows for the same reason (different steps, different checks).
- Split the "failed" copy or tag item into a staff-side SOP (kind 5) and an operator-side recovery SOP (kind 2); different reader, different actions.
- Added "Delete one person's data on request": the PRD (NG-7) and security model make it a by-hand Baseleap job. It may merge into the purge SOP at DOC1.
- Dropped nothing from the candidate list. Left out on purpose (listed under "Not documented"): the homeowner form, inbox extras, the account-setup packet (already the SOP), pipeline drills, rehearsal wind-down, waking a paused Supabase project, kind 1, 3 and 4.

**Could not do:** nothing in scope. Evidence cannot be checked yet because nothing is built; every evidence cell says what will back the row.
**CONTRACT QUESTION:** none for docs. Two findings below belong to other owners.

**Findings for the orchestrator (not fixed by docs):**
- `docs/ops/account-setup.md` Part 7 and the Part 8 checklist still list a Supabase release access token (`SUPABASE_ACCESS_TOKEN`, 28-day expiry) for the GitHub `production` environment. PLAN.md records Matthew's Nov 18 rule (no Supabase personal access token anywhere; release migrations use the production database connection string held only in the GitHub `production` environment). The latest commit message says the token was dropped, but only the staging side was. Owner: devops. Blocks writing the release, rollback and rotation SOPs correctly.
- `docs/architecture.md` says `APP_SIGNING_SECRET`, `CRON_SECRET`, `GHL_LOCATION_ID` and `GHL_API_BASE_URL` are "new, not yet in docs/ops/account-setup.md". The rotation SOP depends on those names being set up in Vercel. Owner: devops.
- Stage-tag failure has no manual retry in the integration contract or the design; the Retry copy button (US-014) is only a Could. Owner: architect and integration, for Gate 2 (see Open question 3 in the plan).

**BLOCKED:** none
**Notes for the next step (DOC1, verify phase):**
- Re-read the plan against what was built and verified. Report any row that was cut (US-014 Retry copy, the board split, Could stories) instead of documenting the plan.
- `node scripts/sop-check.mjs docs/sops` must pass; `docs/sops/changelog.md` and `docs/sops/evidence.md` do not exist yet and are DOC1's outputs.
- Not published to Notion; nothing in the Baseleap SOP Hub was touched or read.
- Step IDs for evidence are not known yet (the build plan is not submitted); evidence cells name files and areas instead.
