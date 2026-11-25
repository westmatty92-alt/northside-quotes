# Roll back a release

**Purpose:** Put the previous working version of the app live again, and check that production is healthy.
**Who:** Matthew, or a Baseleap dev he asks · **When:** A release made production unhealthy, or the automatic rollback did not finish · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#roll-back-a-release)

**DRAFT.** No rollback has run yet, automatic or by hand. DEP1 drills it after Gate 3. Until then every step is unverified.

## Before you start
- You need Matthew's Vercel login. Agents hold no production credentials and never roll back production.
- Roll back first, then find the cause. Do not push a fix straight to `main`.
- The database has no down-migrations. Migrations are built so the previous app version still works on the new tables. A database problem is fixed with a new forward migration through the normal flow.
- The migration files end with commented "rollback" lines. They are not part of this procedure. Do not run them on production.
- The Free Supabase plan has no point-in-time recovery and no downloadable backups. Lost or damaged data cannot be restored from a backup. Matthew decides what to do.

## Steps
1. Confirm there is a problem. Run `node scripts/smoke.mjs https://northside-quotes.vercel.app`. Open Vercel, then the project, then **Logs**, and note the time it started.
2. Look at the latest `release` run in GitHub, under **Actions**. If it says it already rolled back, run the smoke command again. If it passes, go to step 6.
3. ⚠ unverified: Open Vercel, then the project `northside-quotes`, then **Deployments**. Find the last good Production deployment. Open its **⋯** menu and click **Instant Rollback**.
4. Wait for the rollback to finish. Vercel now stops new production deployments from taking the address until one is promoted. The next release promotes on purpose, so it keeps working.
5. ⚠ unverified: The command-line way, on Matthew's machine, is `vercel rollback <deployment-url>`. To undo it, run `vercel promote <deployment-url>`.
6. Check production again. Run the smoke command from step 1, then open `https://northside-quotes.vercel.app/api/health`.
7. Write the incident log entry the same day, in the runbook's Incidents section: what happened, how it was found, who fixed it, and what changes so it does not happen again.

## What you should see
- The smoke command passes. Every path answers 200.
- The health address shows `status: ok` and the commit of the previous version.

## If it goes wrong
- **There is no earlier deployment to go back to:** This was the first release. Production has never served anyone. Matthew decides: fix forward, or delete the failed deployment in Vercel.
- **The smoke check still fails after the rollback:** Check the Vercel variable names against `infra/environments.json`, then look at **Logs**. Tell Matthew. Do not change production settings yourself.
- **The data is wrong or missing after a migration:** Stop. Do not run the commented rollback lines. Matthew decides. For the rehearsal the answer may be to recreate the data from the migrations and accept the loss.
- **The next release does not take the address:** After an Instant Rollback, the next release must promote explicitly. The release workflow does this. If you deployed some other way, promote the deployment by hand.

## Changelog
- 2026-11-25 — First version, a draft from the runbook. The plan assumed the migrations carry usable rollback blocks. The runbook says there are no down-migrations, so that part was dropped. DEP1 drills the rollback after Gate 3 — step DOC1
