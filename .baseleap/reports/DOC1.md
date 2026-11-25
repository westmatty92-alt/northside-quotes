# STEP DOC1 — SOPs for what was built and verified
## Attempt 1 — 2026-11-25
**Status:** done (all four verify commands exit 0). 12 SOPs written, 34 steps marked `⚠ unverified`. Nothing published to Notion.

**Files changed (all under `docs/sops/`, plus this report):**
- `client-staff/work-a-request-in-the-inbox.md` — sign in to sign out, the daily job
- `client-staff/move-requests-on-the-board.md` — Pipeline tab, drag, Move to
- `client-staff/when-a-gohighlevel-copy-shows-failed.md` — the GoHighLevel card and Retry copy
- `operator/add-a-staff-account.md`, `reset-a-staff-password.md` (new, not in the plan), `remove-a-staff-account.md`
- `operator/recover-failed-ghl-syncs.md`
- `operator/release-to-production.md`, `roll-back-a-release.md`, `rotate-app-secrets.md` (drafts, wait for DEP1)
- `operator/delete-one-persons-request.md`, `purge-requests-after-24-months.md` (drafts, never run)
- `evidence.md` — per-SOP evidence and the plan-versus-built table
- `changelog.md` — dated lines and every unverified step, grouped by what would verify it (the Gate 3 input)

## SOP list (owner = who runs it)
| SOP | Owner | Kind | State |
|---|---|---|---|
| work-a-request-in-the-inbox | Owner, office helper | 5 client staff | Verified from staging at `04dd79a` (1 unverified line) |
| move-requests-on-the-board | Owner, office helper | 5 | Verified (2 unverified lines) |
| when-a-gohighlevel-copy-shows-failed | Owner, office helper | 5 | Failed and not-copied states seen; the rest from code (2 unverified) |
| add-a-staff-account | Baseleap (Matthew on production) | 2 operator | Staging part backed by the QA sign-ins; dashboard names and production SQL unverified (3) |
| reset-a-staff-password | Baseleap | 2 | New. Unverified dashboard step and session effect (2) |
| remove-a-staff-account | Baseleap | 2 | Draft, never run (3) |
| recover-failed-ghl-syncs | Baseleap | 2 | Live GoHighLevel never called (7) |
| release-to-production | Matthew approves, Baseleap dev starts | 2 | Draft, DEP1 drills it (4) |
| roll-back-a-release | Matthew, Baseleap dev | 2 | Draft, DEP1 drills it (2) |
| rotate-app-secrets | Matthew, Baseleap dev | 2 | Draft, DEP1 drills it (3) |
| delete-one-persons-request | Baseleap | 2 | Draft, never run (4) |
| purge-requests-after-24-months | Baseleap | 2 | Draft, never run (1) |

Kinds 1, 3 and 4: none. This build makes no company SOP, no install guide and changes no agent.

## Plan versus built (full table in `docs/sops/evidence.md`)
- **Changed:** "switch to Board" became a separate **Pipeline** tab (ruling), with drag from 1280 px (a finger or pen needs the grip; a mouse can pick the card up anywhere except its buttons) and **Move to** below that. Retry copy shipped (US-014); the stage tag has no button, the screen says the next status change starts a new try. Plan questions 2 (password hand-over, reset: runbook has both) and 4 (no Supabase access token) are answered. Rollback lost its "migration rollback blocks": the runbook says no down-migrations.
- **Added:** `reset-a-staff-password`.
- **Merged:** none. The purge SOP links to the delete SOP so the steps exist once.
- **Dropped:** none.

## Acceptance criteria
- One procedure per file from `templates/sop.md` → 12 files, each with Purpose, Who/When/Kind, Before you start, Steps, What you should see, If it goes wrong, Changelog.
- Client staff SOPs in `docs/sops/client-staff/` → 3 files there.
- Every step backed or marked → `docs/sops/evidence.md` (one section per SOP); 34 `⚠ unverified` markers, each in `changelog.md` with what would verify it.
- Facts you listed → staff access (dashboard, `db:staff-add`, production SQL, 12+ characters, phone, no reset email), separate Requests and Pipeline tabs, GHL copy only for ticked requests with "Not copied: no offers consent", Retry copy, live GHL unverified, release/rollback/rotation drafts, `APP_SIGNING_SECRET` and `CRON_SECRET` rules with `INVALID_CRON_SECRET` and "new deployment after any change", 24-month purge and one-person deletion, Fluid Compute (Part 7 step 8, unverified).
- No secrets → `sop-check` secret scan passes; SOPs name settings only. The only addresses are the public app addresses from the runbook.

## Commands run
- `node scripts/stack-ledger.mjs status` → exit 0 (read only)
- `node scripts/sop-check.mjs docs/sops` → exit 0, "12 SOP(s), 0 error(s), 34 unverified step(s)"
- `test -s docs/sops/changelog.md` → exit 0
- `test -d docs/sops/client-staff` → exit 0
- `find docs/sops -name "*.md"` excluding plan, changelog, evidence → 12 files, exit 0
- Read with `git show origin/staging:<path>` (staging is at `04dd79a`, the commit QA ran): `copy.ts` (staff and pipeline), `ghl-card.tsx`, `status-control.tsx`, `move-to-menu.tsx`, `board-card.tsx`, `use-board-drag.ts`, `week-count.tsx`, `staff-shell.tsx`, `sign-in-form.tsx`, `request-row.tsx`, `package.json`.
- Also read: `docs/runbook.md`, `docs/ops/account-setup.md`, `docs/qa-reports/latest-run.md`, `QA2-run.md`, `docs/qa-reports/visual/**` (JSON), `docs/integrations/ghl.md`, `docs/integration-contract.md`, `docs/SECURITY_MODEL.md`, `docs/architecture.md`, PRD and user stories (retention, ACs), `supabase/migrations/*` (cascades, staff, storage), `supabase/scripts/db.mjs`, `vercel.json`, `.github/workflows/release.yml` (top 80 lines), `.baseleap/reports/FE2V.md`, `QA1.md`.

## Unverified (summary; the list with fixes is in `docs/sops/changelog.md`)
- **Live GHL (7):** the Copied and Waiting states on a real screen, a retry ending in Copied, the GHL menu and scope steps, Retry copy live, the clear-the-link statement, contact and tags (OQ-15), two-contact case.
- **Never run (15):** job-list query, cron by hand, dashboard names, production staff SQL, reset and session effect, removal checks, deletion and purge steps.
- **Waits for DEP1 (9):** drill log, required checks and ruleset, approval buttons, Fluid Compute, Instant Rollback, rotation menu names and re-run.
- **From the design only (3):** Requests tab after a move (AC-016.4), board Show more (AC-016.10), empty list (AC-005.4).
- Not checked at all: the Notion hub (not read or written, per the instruction).

**Could not do:** a staging dry run of staff removal, deletion, purge, reset and rotation. This step documents, and holds no credentials. They are the cheapest way to clear 15 of the 34 markers.

**CONTRACT QUESTION:** need `docs/sops/system-map.md` (docs-sop section 3a: rebuilt at every build's docs step) · why: `scripts/sop-check.mjs` checks every `.md` under `docs/sops` except plan, changelog, evidence, index and README, so a system map would fail the check (no Purpose, Steps or Changelog) and stop the verify command · artifact: `scripts/sop-check.mjs` line 10, the `SKIP` set · suggested change: add `system-map.md` to `SKIP`, then docs writes it in a follow-up. I left it out rather than bend the format. Owner of the script is whoever maintains the kit.

**Findings for the orchestrator (not fixed):**
1. FE2 is reopened ("building") while DOC1 ran. The sign-in, Requests and detail SOPs rest on the code at `04dd79a`. If FE2 changes a label, those SOPs go stale and come back to docs.
2. Every request with the offers box ticked shows "Copy to GoHighLevel failed" until the token and location id are set (seen on staging, `SCR-06-ticked`). If production goes live first, the owner sees failed copies on day one. Consider setting them before Gate 3, or tell Northside to expect it. The staff SOP already says so.
3. No document says how to confirm who is on the phone before resetting a password. The reset SOP does not invent a check.
4. The retention rhythm and the start of the 24 months are undecided. The purge SOP asks Matthew to approve the exact list before any deletion. That safeguard is mine, added because deletion is permanent and the Free plan has no backup.
5. `docs/ops/pipeline-drills.md` and `docs/deployments/release-log.md` do not exist. The runbook's release precondition ("the drill log shows release and rollback passed") cannot be met until DEP1 creates them.
6. The sign-in pause message says "a few minutes", while the pauses are 5 and 15 minutes. The staff SOP says "wait 15 minutes" to cover both. Not a defect.
7. The reports for FE2, FE3, BE1 to BE3, INT2, REV1 and SEC1 are not in the main tree. I cited the code on staging and QA's runs instead. If those reports hold UI facts I missed, the SOPs may need a pass.
8. QA did not assert whether a mouse drag needs the grip. The SOP follows the code (mouse: anywhere except buttons).

**BLOCKED:** none.

**Notes for the next step:** Publish nothing before Gate 3. At Gate 3, the packet is `docs/sops/changelog.md`. After DEP1 runs the release, rollback and rotation drills, send those three SOPs back to docs. Replace each button name with what the drill showed, drop the `⚠ unverified` markers, and fill in the drill log link. Kind 5 SOPs have no Notion home yet (plan question 1). They stay in `docs/sops/client-staff/` unless Matthew names a place.

## Gate 3 summary
- 12 SOPs are written: 3 for Northside staff (inbox, board, GoHighLevel card) that rest on the verified staging app, and 9 for Baseleap.
- 34 steps are marked unverified. Live GoHighLevel was never called, and release, rollback and rotation wait for the DEP1 drills. The 5 staff-access and deletion SOPs have not been run end to end.
- Nothing is published. Decide: where the client SOPs live, how often to purge, and whether to set the GoHighLevel token before go-live.
