# SOP evidence: Northside quote requests

Written 2026-11-25 by step DOC1. Each section is one SOP, named like its file. Each line says which step in the SOP rests on which evidence. A step with nothing behind it is written in the SOP as `⚠ unverified` and listed in `docs/sops/changelog.md`.

## How the evidence was read

- **Screens and words (staff SOPs):** the code on `origin/staging` at commit `04dd79a`, read with `git show origin/staging:<path>`. This is the same commit QA ran against (`docs/qa-reports/latest-run.md`: 156 of 156 passed, status `ok`). The words in bold in the staff SOPs are copied from `src/components/staff/copy.ts` and `src/components/staff/pipeline/copy.ts`. Where a screenshot exists, it was used to confirm the screen exists.
- **Ledger state when this was written** (`node scripts/stack-ledger.mjs status`): verified or done: P0, D1, OPS-SETUP, A1, S0, DOC0, A2, OPS1, BE1, INT1, FE1, BE2, BE3, FE3, INT2, QA1, QA2, DV1, FE2V, A3. **Not finished: FE2 (reopened, status "building"), REV1, SEC1.** DEP1 is queued. So the sign-in, Requests and detail screens (FE2) may still change. If FE2 changes a label, the staff SOPs `work-a-request-in-the-inbox` and `when-a-gohighlevel-copy-shows-failed` are stale and come back to docs.
- **No pipeline drill has run.** `docs/ops/pipeline-drills.md` and `docs/deployments/release-log.md` do not exist. There was no run to cite for release, rollback or rotation.
- **Not available to this step:** the reports of FE2, FE3, BE1 to BE3, INT2, REV1 and SEC1 are not in the main tree (only A1, A2, A3, D1, DOC0, FE2V, INT1, OPS-SETUP, OPS1, P0, QA1, QA2 are). The ledger lists those steps as done, so their behaviour is cited through the code on staging and QA's report instead.

## Plan check: what changed between `docs/sops/plan.md` and what was built

| Planned procedure | Result | What changed |
|---|---|---|
| Work a new request from the inbox list | Written | The inbox is the **Requests** tab. There is a status filter and a search. The weekly strip is on both tabs. The sign-in pause message says "a few minutes", and the SOP says to wait 15 minutes to cover both limits |
| Move requests on the board | Written | There is no Board switch. **Pipeline** is a separate tab (ruling, FR-26). A mouse can drag from anywhere except the buttons. A finger or pen needs the grip, shown from 1280 px. Below that, **Move to** is the way |
| GoHighLevel copy failed (staff side) | Written | **Retry copy** (Could) shipped. The stage tag has no button. The screen says "The next status change starts a new try". Unticked requests show **Not copied: no offers consent** and have no button and no stage tag line |
| Recover failed GoHighLevel syncs (operator) | Written, mostly unverified | Live GoHighLevel was never called (no token, no location id). No staged-failure drill was run on staging. QA holds no `CRON_SECRET`, so the cron route was not driven with the right secret |
| Add a staff account | Written | Plan question 2 is answered: phone hand-over, 12+ characters, one per account. Staging uses `npm run db:staff-add`. Production uses SQL from the runbook |
| Remove a staff account | Written, draft | Never run on staging. Every check stays unverified |
| Release to production | Written, draft | Plan question 4 is answered: no Supabase access token. The release uses the Vercel token and the production database string. No drill has run |
| Roll back a release | Written, draft | The plan assumed usable rollback blocks. The runbook says no down-migrations, fix forward. No drill has run |
| Purge requests after 24 months | Written, draft | No dry run. The rhythm and the start date of the 24 months are not decided |
| Delete one person's data | Written, draft | Kept as its own SOP. The purge SOP links to it for each request, so there is one copy of the steps |
| Rotate the app secrets | Written, draft | No rotation drill has run. Secrets table is from the runbook. The `INVALID_CRON_SECRET` lesson from staging is included |
| (not in the plan) Reset a forgotten staff password | New | The runbook now has this procedure. It was plan question 2 |

Not written, as the plan said: homeowner form, inbox extras, account-setup, drills, agent SOPs, company SOPs. Not written at all: `docs/sops/system-map.md`. See the DOC1 report.

## work-a-request-in-the-inbox

- **Steps 1 to 4 (sign in):** `origin/staging:src/components/staff/sign-in-form.tsx` and `copy.ts` (`signIn`: Staff sign-in, Email, Password, Show, Sign in). Screenshots: `docs/qa-reports/visual/FE2/1280/SCR-03-signed-out.png`, `.../390/SCR-03-signed-out.png`. Run: the done spine, step "the owner signs in and sees it first" (`docs/qa-reports/latest-run.md`, "Done spine: PASSED"). AC-004.1 to AC-004.4 pass.
- **Steps 5 to 7 (list, filter, search, open):** `copy.ts` (`list`: Show requests, All, Search by reference, name or phone, Search); `request-row.tsx` (the reference and the name are both links). AC-005.1, .2, .3, .6, .8, .9, .10 (list and open), AC-011.1, .3, .4 (filter) and AC-013.1 to .3 (search) pass (`latest-run.md`). Screenshots: `FE2/1280/SCR-04-requests.png`, `FE2/390/SCR-04-requests.png`, `DV1/SCR-04-requests-1280x800.png`.
- **Step 8 (read the request, photos):** `copy.ts` (`detail`: The request, Photos, View photo N, Close). Screenshots: `FE2/1280/SCR-06-ticked.png`, `FE2/1280/SCR-08-photo-viewer.png`, `DV1/SCR-08-photo-viewer-1280x800.png`. AC-005.3, AC-012.1 and AC-012.2 pass, and so does the photo viewer focus trap.
- **Steps 9 to 11 (price, note, save):** `copy.ts` (`detail.price`, `note`, `save`, `saved`, `savedBody`). Run: the spine, "price and note survive a reload". AC-006.1 to AC-006.7 pass.
- **Step 12 (status):** `origin/staging:src/components/staff/status-control.tsx` (four buttons, saves at once, any status to any other, the hint that saving a price does not change the status). Run: the spine, "Won from the list". AC-007.1 to AC-007.6 pass.
- **Step 13 (weekly count):** `week-count.tsx`; PRD FR-13 (Monday to Sunday, Hamilton time). Run: the spine, "the weekly Won count moved within 2 s". AC-008.1, .2, .5, .8 pass. Screenshot: `FE2/1280/SCR-07-weekly-strip.png`.
- **Steps 14 and 15:** `copy.ts` (`detail.backTo`, `nav.signOut`); `staff-shell.tsx`.
- **If it goes wrong:**
  - Sign-in messages: `copy.ts` (`signIn.wrong`, `paused`, `unavailable`, `failed`, `ended`). Limits: `docs/SECURITY_MODEL.md` "Authentication and sessions" (5 failures in 15 minutes pause an email for 5, 20 failures pause an address for 15, one message for both). Probes `PRB-50` to `PRB-52` pass (`docs/qa-reports/QA2-run.md`). Wrong password screenshot: `FE2/1280/SCR-03-wrong-password.png`.
  - No reset email, no forgot-password link: `sign-in-form.tsx` header comment, `docs/SECURITY_MODEL.md`, `docs/runbook.md` "Staff accounts and passwords"; probes `PRB-06`, `PRB-06b` pass.
  - Session ended after 7 days: `docs/SECURITY_MODEL.md` ("7-day sessions"). The 7-day expiry was not tested (QA2-run.md, "Not run").
  - Price, note, save, stale and reload wording: `copy.ts` (`detail`). The behaviours are covered by AC-006 and AC-007 passes. The failed-save and stale banners were not screenshotted. Their wording is read from the code.
  - "Photo unavailable", "Couldn't load requests", "Count unavailable": `copy.ts`. AC-005.7 is partly unverified (only the browser-side failure was exercised, `latest-run.md` "Unverified"). AC-005.4 ("No quote requests yet") is not in QA's pass list, so that line is from the code only.
- **Unverified in this SOP (1 marked):** the "No quote requests yet" line. Note also the FE2 reopening above.

## move-requests-on-the-board

- **Steps 1 and 2 (the Pipeline tab, columns, Jump to a column):** `origin/staging:src/components/staff/pipeline/copy.ts` (`pipeline.title`, `jump`, `columnOrder`); `staff-shell.tsx` and `copy.ts` (`nav.pipeline`). Screenshots: `docs/qa-reports/visual/DV1/SCR-05-pipeline-1280x800.png`, `.../SCR-05-pipeline-390x844.png`. AC-016.1, AC-016.19 and AC-016.20 pass.
- **Step 3 (Move to):** `move-to-menu.tsx`; AC-016.3 (keyboard) and AC-016.17 (taps on a phone) pass. Screenshot: `DV1/SCR-05-move-to-saving-1280x800.png`.
- **Step 3 (drag):** `use-board-drag.ts` (a mouse picks a card up anywhere except its buttons; a finger or pen only by the grip); `board-card.tsx` (the grip shows from the `xl` width, 1280 px); `pipelineCopy.release` ("Release to move to …"). AC-016.2 (mouse, grip touch drag, Move to) passes. Not asserted by QA: that a mouse drag does not need the grip (`latest-run.md` "Unverified"). The SOP follows the code.
- **Step 4 (cancel):** `use-board-drag.ts` (Escape, a drop outside the columns, a drop on its own column store nothing); `pipelineCopy.about`. AC-016.6 and AC-016.7 pass.
- **Steps 5 and 6 (Saving, weekly count):** `board-card.tsx` ("Saving"); `pipelineCopy.moved`; the spine, "Won again from the board", "the weekly Won count moved within 2 s". AC-016.8 (a moved card takes its time position, not the top) passes.
- **Step 7 and 8 (open a card, Show more):** `board-card.tsx` (link to `/pipeline/<id>`), `copy.ts` (`detail.backTo('Pipeline')`), `pipelineCopy.showMore`. AC-016.5 (open a card) passes. AC-016.10 (51 cards) is **not** run (needs 51 requests, `latest-run.md` "Unverified"). The "Show more" step rests on the code only.
- **What you should see:** AC-016.4 (the Requests tab lists the moved request with its new status) is not in QA's pass list. The SOP line rests on `docs/design-specs.md` SCR-05 and is marked unverified there.
- **If it goes wrong:** `pipelineCopy` (`saveFailed`, `saveFailedBody`, `stale`, `staleBody`, `reload`, `loadFailed`). AC-016.12 (changed by someone else), AC-016.13 (save fails), AC-016.14 (session expired) and AC-016.15 (cannot load) pass. Finding BUG-FE2V-2 (the accessible name of a saving Move to button) is not in the SOP: it does not change what a person sees (`.baseleap/reports/FE2V-errors.md`).
- **Unverified in this SOP (2 marked):** the AC-016.4 line, and the "Show more" step (code only).

## when-a-gohighlevel-copy-shows-failed

- **Step 1 (the card):** `origin/staging:src/components/staff/ghl-card.tsx` and `copy.ts` (`detail.ghl`). Screenshot: `docs/qa-reports/visual/FE2/1280/SCR-06-ticked.png` and its JSON (`copy_state: failed`, offers ticked) and `SCR-06-unticked.png` (`copy_state: not_copied_no_consent`).
- **Step 2:** the two states **Copy to GoHighLevel failed** and **Not copied: no offers consent** were seen on staging (`FE2V.md`: "GoHighLevel states other than failed / not copied are unreachable on staging"). **Copied to GoHighLevel** and **Waiting to retry** are read from `ghl-card.tsx` and `copy.ts` only. This is the first marked step.
- **Steps 3 and 4 (Retry copy):** `ghl-card.tsx` (the button shows only when the copy state is failed, reads "Retrying" while it runs, `retryFailed` and `retryUnavailable` banners). `docs/integration-contract.md` (manual retry, consented requests only, a direct call on an unticked request is refused with 409). AC-010.6 and AC-014.4 pass (no Retry control on an unticked request). Probes `PRB-40` to `PRB-44` pass, including "copy retry on an unticked request 409". The rest of US-014 was tested only against the offline simulator (INT2). Live behaviour: unverified, the second marked step.
- **Step 5 (stage tag):** `copy.ts` (`tagUpToDate`, `tagWaiting`, `tagFailed`, `tagFailedHint` "The next status change starts a new try."). This answers plan question 3 for the staff side.
- **If it goes wrong:** the statement that every ticked request fails until the token and location are set: `SCR-06-ticked` (state failed on staging, where the token is unset), `docs/qa-reports/latest-run.md` "Unverified", `docs/integrations/ghl.md` (`config_missing`). Deleted contact and "stop emails": `docs/integration-contract.md` and `docs/integrations/ghl.md` runbook.

## add-a-staff-account

- **Rules (12 characters, one per account, phone hand-over, no reset email):** `docs/runbook.md` "Staff accounts and passwords"; `docs/SECURITY_MODEL.md` "Authentication"; ledger ruling 3A and OQ-17 in `docs/PRD.md` (FR-27).
- **Step 2 and 3 (dashboard):** `docs/runbook.md` only. No run followed these clicks. Marked unverified. The runbook itself says it is unverified whether the dashboard form enforces the minimum length.
- **Step 4 (`npm run db:staff-add`):** `origin/staging:package.json` (script `db:staff-add`), `supabase/scripts/db.mjs` (the command, its output line `db: <email> is staff on the <name> (added now | already staff, unchanged)`, and the error "no Supabase Auth user has this email (create it in the dashboard first)"), `docs/architecture.md` (staging staff accounts `owner@northside.test` and `helper@northside.test`).
- **Step 5 (production SQL):** `docs/runbook.md`. Production has never been touched. Marked unverified.
- **Step 7 (check the sign-in):** the staging owner and helper signed in during the QA runs (the done spine, `latest-run.md`; `docs/qa-reports/visual/FE2/**`). **Signed in as …** from `copy.ts` (`nav.signedInAs`).
- **If it goes wrong:** `db.mjs` messages; `docs/runbook.md` (Auto Confirm, SMTP warning, SEC-10); `docs/SECURITY_MODEL.md` ("Supabase Auth recovery and OTP endpoints exist", sign-in pause).

## reset-a-staff-password

- **All steps:** `docs/runbook.md` "Staff accounts and passwords", paragraph "Reset a forgotten password". That paragraph says the dashboard wording varies. No reset has been run. Step 2 is marked unverified.
- **Pause is not lifted by a new password:** `docs/SECURITY_MODEL.md` ("nobody, not even the server, updates a pause"; the pause is by email and address, not by password).
- **Existing sessions after a reset:** not in any document. Marked unverified.
- **No email, no custom SMTP:** `docs/runbook.md`, `docs/SECURITY_MODEL.md` (SEC-10).

## remove-a-staff-account

- **Cascade of the staff row when the auth user is deleted:** `supabase/migrations/20261120000200_staff.sql` (`user_id ... on delete cascade`), `docs/architecture.md` (the `on delete` choices), `docs/SECURITY_MODEL.md` (personal data table: "Baseleap removes the auth user (cascades the staff row)").
- **"Last updated by a removed account":** `supabase/migrations/20261120000300_quote_requests.sql` (`last_staff_update_by ... on delete set null`), `copy.ts` (`detail.lastUpdated`). Read from code only.
- **Access is refused without a staff row:** `app_private.is_staff()` in the staff migration needs a staff row and a session under 7 days old. The RLS tests (`supabase/tests/rls/staff.sql`) cover the staff table. No test or run removes a user and then signs in.
- **Steps 2, 3 and 4:** unverified (no run on staging).

## recover-failed-ghl-syncs

- **Context (no live call, token and location not set):** `docs/integrations/ghl.md` header and "Unverified (live)"; `docs/qa-reports/latest-run.md` "Unverified"; `docs/qa-reports/QA2-run.md` ("live GoHighLevel (no request had consent)").
- **Step 2 (the query):** copied from `docs/integrations/ghl.md` "Runbook". Not run in a drill. Marked unverified.
- **Step 3 (error classes and backoff):** `docs/integration-contract.md` ("When the platform is down", backoff 5 min, 1 h, 3 h, 6 h, 12 h; `auth`, `config_missing`, `rejected` never retry); `docs/integrations/ghl.md` Runbook table.
- **Steps 4 and 5 (settings, token, scopes):** `docs/ops/account-setup.md` Part 3 (`GHL_LOCATION_ID` is Config, the token is Sensitive and later), `docs/integrations/ghl.md` (exact scopes `contacts.readonly` and `contacts.write`, rotation every 90 days, 7-day overlap). The GoHighLevel menu names are unverified.
- **Step 6 (Retry copy):** `ghl-card.tsx`; contract "Manual retry". Live behaviour unverified.
- **Step 7 (rejected, deleted contact):** `docs/integrations/ghl.md` Runbook ("rejected": Baseleap clears `ghl_contact_id` and `ghl_linked_at` together). The statement itself is not in a run. Marked unverified.
- **Step 8 (cron by hand):** `vercel.json` (four `ghl-sync` entries at 00:00, 06:00, 12:00, 18:00 UTC; one `housekeeping`), `docs/runbook.md` ("Cron Jobs ... run `housekeeping` once"). Running `ghl-sync` the same way is an assumption. Marked unverified. QA2 sent the correct secret to no route (`QA2-run.md` "Not run").
- **Step 9 (contact and tags in GoHighLevel):** `docs/integration-contract.md` (tags `quote-request`, `quote-new`, `quote-quoted`, `quote-won`, `quote-lost`); OQ-15 in `docs/integrations/ghl.md` "Unverified (live)" item 2. Unverified.
- **If it goes wrong:** the two retry banners from `copy.ts`; Fluid Compute from `docs/ops/account-setup.md` Part 7 step 8; "two contacts" from `docs/integrations/ghl.md` Unverified (live) item 6; "stop emails" from the same runbook table (NG-16).

## release-to-production

- **Before you start:** `docs/runbook.md` "Deploy (normal release)" preconditions. The drill log does not exist (checked: `docs/ops/pipeline-drills.md` is missing). Marked unverified.
- **Production setup:** `docs/ops/account-setup.md` Part 7. **Secret rules and `INVALID_CRON_SECRET`:** Part 3 (the warning "learned on staging"). **Fluid Compute:** Part 7 step 8, status "unverified for this project". Marked unverified.
- **Steps 1 to 4:** `docs/runbook.md` "Deploy", `.github/workflows/release.yml` (starts on a push to `main`, environment `production`, reviewer approval). The names **Review deployments** and **Approve and deploy** are from the runbook only. Marked unverified. The ruleset that requires the four checks is set by Matthew after the first checks (`docs/runbook.md` "Platform settings", "Last verified: not yet").
- **Step 5 (stages):** the flow comment at the top of `release.yml` and `docs/runbook.md` step 3.
- **Step 7 (health):** `docs/runbook.md` "At a glance" and "Health, logs and uptime"; `scripts/smoke.mjs` described there. `GET /api/health` returned `ok` with the commit on staging in the QA runs (`latest-run.md` preflight). The production address is not live yet.
- **Step 8 and 9:** `docs/runbook.md` (production staff accounts at release time; release log by pull request).
- **If it goes wrong:** `docs/runbook.md` (automatic rollback, "First release only", "Re-running with new variables", Incidents). No failed drill attempt exists to quote.

## roll-back-a-release

- **All steps:** `docs/runbook.md` "Roll back", "Incidents", "Health, logs and uptime". No rollback has run. Steps 3 and 5 name Vercel's **Instant Rollback** and the `vercel rollback` command from the runbook only. Marked unverified.
- **No down-migrations, fix forward, no point-in-time recovery on the Free plan:** `docs/runbook.md` "Roll back" (Database). The commented rollback lines at the end of the migration files (for example `supabase/migrations/20261120000200_staff.sql`) are the reason the plan assumed rollback blocks. They are not a procedure.

## rotate-app-secrets

- **Table of secrets, where they live, effects, checks:** `docs/runbook.md` "Secrets and rotation" (rows for each name), `infra/environments.json` (the list of record), `docs/ops/account-setup.md` Part 3 ("The two secrets you generate"), "Afterwards" (release token every 28 days).
- **Rules for `APP_SIGNING_SECRET` and `CRON_SECRET` (32+ characters, different per environment, no trailing whitespace, new deployment needed):** `docs/ops/account-setup.md` Part 3. **`INVALID_CRON_SECRET`:** the same Part 3 warning, learned on the staging Preview.
- **Step 5 (`env-check`):** `docs/runbook.md` "Environments and where each setting lives" (`node scripts/env-check.mjs --vercel`, names, targets and types only).
- **Steps 2, 4 and 6:** dashboard and button names from the runbook only. Marked unverified. No rotation was run. The release drill in DEP1 is meant to rotate one secret.
- **GoHighLevel token (90 days, 7-day overlap):** `docs/integrations/ghl.md` and `docs/integration-contract.md`.

## delete-one-persons-request

- **What deletes with the request:** `supabase/migrations/20261120000300_quote_requests.sql` (photos and history `on delete cascade`), `supabase/migrations/20261120000400_ghl_sync.sql` (jobs cascade), `docs/architecture.md` (the `on delete` choices; events cascade). `docs/SECURITY_MODEL.md` "Personal data" table (the row is deleted by SQL, the `{request_id}/` folder through the Storage API, the GHL contact by hand).
- **Storage can't be deleted by SQL:** `supabase/migrations/20261120000700_storage.sql` ("Supabase refuses direct SQL deletes from storage tables"; no client can delete a photo; only the server does).
- **Deletion by Baseleap only (NG-7):** `docs/PRD.md` NG-7; the probes show no delete route exists (`PRB-04`, `PRB-05`: "a request can never be deleted", `QA2-run.md`).
- **Shared contact (one per homeowner):** `docs/integration-contract.md` (ruling 2A).
- **Steps 1, 3, 4 and 5:** never run. Marked unverified. QA left test requests on staging (`docs/qa-reports/latest-run.md` "Test data left on staging") that are a ready dry-run set.
- **Unfinished requests:** `docs/architecture.md` (housekeeping purges stale pending requests after 24 hours); pending requests have no reference (`quote_requests_submitted_has_reference`).

## purge-requests-after-24-months

- **The rule:** `docs/PRD.md` OQ-10, option A ("keep 24 months then Baseleap purges by hand"), `docs/SECURITY_MODEL.md` personal data table. Not a rule for the rehearsal: "rehearsal data is test data".
- **No automatic purge:** `docs/architecture.md` (housekeeping purges only stale pending requests and counter rows older than 24 hours).
- **Step 1 (the query):** written from the table's columns (`state`, `submitted_at`) in `supabase/migrations/20261120000300_quote_requests.sql`. Not run. Marked unverified. The start of the 24 months is not defined in any document.
- **Steps 3 to 6:** follow the delete SOP. Matthew's approval of the list is a safeguard added here because the deletion cannot be undone and the Free plan has no backup (`docs/runbook.md` "Roll back").
