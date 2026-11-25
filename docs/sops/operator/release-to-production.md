# Release to production

**Purpose:** Put the checked staging version live, with Matthew's approval, and prove it is healthy.
**Who:** Matthew (approves), a Baseleap dev (starts it) · **When:** After Gate 3 is approved · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#release-to-production)

**DRAFT.** No release has run yet. The first one is the drill in step DEP1, after Gate 3. Until it runs, every step that names a GitHub or Vercel button is unverified. Replace each button name with what you see on screen, and remove the marker.

## Before you start
- Gate 3 (`release_approval`) is approved.
- The code review and the security review say APPROVED, and QA says PASS on the exact commit on `staging`.
- The Gate 3 packet names the database migrations that will run.
- ⚠ unverified: The drill log shows a release and a rollback passed (`docs/ops/pipeline-drills.md`). That file does not exist yet. DEP1 creates it.
- Production is set up as in Part 7 of [account-setup.md](../../ops/account-setup.md): the `Northside production` project, the Vercel Production rows, and the GitHub `production` environment.
- The production values of `APP_SIGNING_SECRET` and `CRON_SECRET` each have 32 or more characters. They are different from the staging values and from each other. Nothing follows the last character, no space and no line break. A trailing space in `CRON_SECRET` broke the staging Preview build with the error `INVALID_CRON_SECRET`.
- ⚠ unverified: **Fluid Compute** is on for the Vercel project. In Vercel, open the project, then **Settings → Functions**, then the **Fluid Compute** section. The switch must be on. The cron route needs a 300-second run. Nobody has looked at this project's setting. If a price appears, stop and open a spend gate.
- `GHL_PRIVATE_INTEGRATION_TOKEN` is not set yet. Until it is, copies to GoHighLevel show as failed. That does not block the release.

## Steps
1. DevOps opens a pull request from `staging` to `main`. It carries the Gate 3 summary, the migration list and the rollback plan.
2. ⚠ unverified: Wait for the four required checks, `verify`, `api-tests`, `security` and `workflows`, to pass. Then merge. The ruleset that requires them is set by Matthew after the first checks have run.
3. The merge starts the `release` workflow. It stops and waits for approval. Nothing live changes yet.
4. ⚠ unverified: Matthew opens GitHub, then **Actions**, then the `release` run that is waiting, then clicks **Review deployments**. He ticks `production` and clicks **Approve and deploy**.
5. Watch the run. It does these in order: check the Vercel variable names, record the version that is live now (the restore point), check the database is the production one, list and apply the pending migrations, build and deploy without moving the address, move the address to the new version, and run the smoke check.
6. Wait for the run to turn green. The summary says the version that is now live.
7. Check production. Open `https://northside-quotes.vercel.app/api/health`. It must show `status: ok` and the new commit. Or run `node scripts/smoke.mjs https://northside-quotes.vercel.app`.
8. Create the production staff accounts with [add-a-staff-account.md](add-a-staff-account.md). Production accounts are made at release time, not before.
9. DevOps adds the entry to `docs/deployments/release-log.md` through a pull request to `staging`, and updates the runbook.

## What you should see
- The `release` run is green, and the summary names the commit.
- The health address shows `status: ok` and that commit. Every smoke path answers 200.
- The first release says it had no restore point to record. That is expected the first time only.

## If it goes wrong
- **The promotion or the smoke check fails:** The workflow moves the address back to the recorded version by itself and marks the run failed. Migrations stay applied, because they are built so the previous version still works. Confirm with the smoke command, then follow [roll-back-a-release.md](roll-back-a-release.md).
- **First release failed and nothing was live before:** There is nothing to roll back to, and production has never served anyone. Matthew decides: fix forward through the normal flow, or delete the failed deployment in Vercel.
- **The build fails with `INVALID_CRON_SECRET`:** The `CRON_SECRET` value has a space or a line break at the end. Paste it again in Vercel with nothing after the last character. Then re-run the release run (**Re-run all jobs**, approval needed again). Do not use the Redeploy button on Production.
- **The run never asks for approval:** The `production` environment needs Matthew's account as reviewer and the branch `main`. Check them in GitHub, under **Settings → Environments**.
- **The variable check fails:** A Vercel variable is missing or in the wrong environment. The message names it. Fix it by name in Vercel and re-run.
- **Production is down later:** The `uptime` check opens an issue called "Production is down". Follow the runbook's Incidents section.

## Changelog
- 2026-11-25 — First version, a draft from the runbook and the release workflow. No release or drill has run yet. DEP1 runs it after Gate 3 — step DOC1
