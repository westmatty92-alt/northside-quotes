# SOP changelog: Northside quote requests

Newest first. One line per change. Gate 3 reads this file.

- 2026-11-25 — New: `client-staff/work-a-request-in-the-inbox.md` — sign in, find, price, note, status, weekly count, sign out; written from the staging preview at `04dd79a` and QA's run — DOC1
- 2026-11-25 — New: `client-staff/move-requests-on-the-board.md` — the separate Pipeline tab, drag from 1280 px, **Move to**; the plan's "switch to Board" is gone because the build has no such switch — DOC1
- 2026-11-25 — New: `client-staff/when-a-gohighlevel-copy-shows-failed.md` — the GoHighLevel card, **Retry copy** (shipped), no retry for the stage tag, "Not copied: no offers consent" — DOC1
- 2026-11-25 — New: `operator/add-a-staff-account.md` — dashboard user, `npm run db:staff-add -- <email>` on staging, SQL on production, password by phone — DOC1
- 2026-11-25 — New (not in the plan): `operator/reset-a-staff-password.md` — the plan's open question 2, answered by the runbook — DOC1
- 2026-11-25 — New, draft: `operator/remove-a-staff-account.md` — never run — DOC1
- 2026-11-25 — New, mostly unverified: `operator/recover-failed-ghl-syncs.md` — live GoHighLevel has never been called — DOC1
- 2026-11-25 — New, draft: `operator/release-to-production.md` — no release has run; DEP1 drills it after Gate 3 — DOC1
- 2026-11-25 — New, draft: `operator/roll-back-a-release.md` — no rollback has run; the plan's migration rollback blocks are dropped because the runbook says no down-migrations — DOC1
- 2026-11-25 — New, draft: `operator/rotate-app-secrets.md` — no rotation has run; includes the `INVALID_CRON_SECRET` lesson and "new deployment after any change" — DOC1
- 2026-11-25 — New, draft: `operator/delete-one-persons-request.md` — kept separate from the purge SOP, which links to it — DOC1
- 2026-11-25 — New, draft: `operator/purge-requests-after-24-months.md` — rhythm and start date of the 24 months are not decided — DOC1
- 2026-11-25 — New: `evidence.md` — evidence for each SOP, and the plan-versus-built check — DOC1

## Unverified steps (for Gate 3)

34 steps are marked `⚠ unverified` across 12 SOPs. Nothing is published to Notion before Gate 3. Each line says what would verify it.

### Live GoHighLevel (no token, no location id set)
- `client-staff/when-a-gohighlevel-copy-shows-failed.md`, step 2: **Copied to GoHighLevel** and **Waiting to retry** seen on a real screen. Only failed and not-copied were seen on staging. Verified by the first live test on the test sub-account.
- `client-staff/when-a-gohighlevel-copy-shows-failed.md`, step 4: a retry that ends in **Copied to GoHighLevel**. Tested only against the offline stand-in. Verified by a live test with a ticked request.
- `operator/recover-failed-ghl-syncs.md`, step 5: the GoHighLevel Private Integrations menu names, the two scopes, token replacement. Verified by the live setup.
- `operator/recover-failed-ghl-syncs.md`, step 6: **Retry copy** against live GoHighLevel.
- `operator/recover-failed-ghl-syncs.md`, step 7: clearing `ghl_contact_id` and `ghl_linked_at` for a deleted contact. Verified by a staged drill.
- `operator/recover-failed-ghl-syncs.md`, step 9: contact and tags in GoHighLevel, and whether a missing tag is created by itself (OQ-15). Verified by the live test.
- `operator/recover-failed-ghl-syncs.md`, "If it goes wrong", two contacts for one homeowner: whether GoHighLevel finds a contact created seconds earlier. Verified by the live test.

### Never run on staging or production (the step exists in no run)
- `operator/recover-failed-ghl-syncs.md`, step 2: the job-list query. Verified by a staged failure on staging.
- `operator/recover-failed-ghl-syncs.md`, step 8: running `ghl-sync` by hand from Vercel **Cron Jobs**. Verified by a run on production, or on staging with the secret.
- `operator/add-a-staff-account.md`, steps 2 and 3: the Supabase dashboard button names, and whether the dashboard enforces the 12-character minimum. Verified by the first account made with the dashboard open.
- `operator/add-a-staff-account.md`, step 5: the production SQL. Verified when production staff are made at release.
- `operator/reset-a-staff-password.md`, step 2: the dashboard way to set a password. Verified by a reset on a staging test account.
- `operator/reset-a-staff-password.md`, "If it goes wrong": whether a reset ends existing sessions. Verified by the same run with a second browser open.
- `operator/remove-a-staff-account.md`, steps 2, 3 and 4: deleting the user, the staff count dropping, a removed person refused. Verified by a staging run on a test account.
- `operator/delete-one-persons-request.md`, steps 1, 3, 4 and 5: the lookup query, the Storage folder deletion, the delete cascade, the GoHighLevel contact deletion. Verified by a dry run on one staging test request. QA left test requests on staging that can be used.
- `operator/purge-requests-after-24-months.md`, step 1: the query, and which date the 24 months start from. Needs a decision from Matthew and a dry run with a request whose dates were set back.

### Waits for the DEP1 pipeline drills (after Gate 3)
- `operator/release-to-production.md`: the drill log (the file does not exist), the four required checks and the ruleset, **Review deployments** and **Approve and deploy**, and **Fluid Compute** on for this project.
- `operator/roll-back-a-release.md`, steps 3 and 5: Vercel **Instant Rollback** and `vercel rollback`.
- `operator/rotate-app-secrets.md`, steps 2, 4 and 6: the dashboard page names, the Vercel menu names, and **Re-run all jobs** with approval.

### Read from the design, not from a test
- `client-staff/move-requests-on-the-board.md`, "What you should see": the Requests tab shows the moved request in the same place (AC-016.4 has no passing test).
- `client-staff/move-requests-on-the-board.md`, step 8: **Show more** on the board (AC-016.10 needs 51 requests; QA did not run it).
- `client-staff/work-a-request-in-the-inbox.md`, "If it goes wrong": **No quote requests yet** (AC-005.4 has no passing test).

## Open items the SOPs cannot settle (for Matthew or the orchestrator)
- FE2 is open again in the ledger. If it changes a label, the two staff SOPs for the inbox and the GoHighLevel card come back to docs.
- No document says how to check who is phoning for a password reset. The reset SOP does not invent a check.
- How often to run the 24-month purge, and which date it counts from.
- The Notion home for the three client staff SOPs. They stay in `docs/sops/client-staff/` and are not published to the Baseleap hub.
- `docs/sops/system-map.md` was not written, because `scripts/sop-check.mjs` would reject it. See the DOC1 report.
