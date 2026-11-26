# Pipeline drills for Northside quote requests

<!-- bl-devops keeps this file. One row per attempt, newest first inside each drill. Evidence = run links, versions, what production reported.
     Names only, never values. A drill passes only when its last attempt passed; a failure stays in the log with what was fixed. -->

**Why:** a first failed release must not leave the site broken, and a rotated secret must reach the running app. These drills prove the release, a rollback and a secret rotation on the real accounts while production has no users.
**Round:** DEP1 (Matthew chose three drills, finishing on a healthy release). Production Supabase `Northside production` (ref `epwbzhezitsknqtuykgv`, ca-central-1) is a rehearsal project that Matthew deletes afterwards.
**Who approves:** Matthew, every production step: merging the pull request and **Review deployments → production → Approve and deploy** on every run. Agents never merge to `main`, approve, deploy or roll back production.
**Production address:** `https://northside-quotes.vercel.app`

## Summary

| Drill | What it proves | Status | Last attempt | Evidence |
|---|---|---|---|---|
| D1. Release (first release) | approval, drift check, first-release path with no restore point, migrations, deploy, promote, live check reports this commit | not started | | |
| D2. Instant Rollback | Matthew can put the previous deployment back from the dashboard in one click, and the previous commit answers | not started | | |
| D3. Secret rotation, ending on a healthy release | a rotated value reaches the running app only after a re-run of the release; the re-run promotes explicitly after an Instant Rollback | not started | | |

Not covered by this round (so the ops-release §5 list is not complete): the automatic rollback on a failed smoke check (a planted production-only failure), expand/contract with no failed requests, the uptime alert, the guardrails drill. `release.yml` has the automatic path but it is unproven until a planted failure is run. Matthew decides whether it is drilled before a real client goes live.

## Order of events

D2 needs two production deployments with different commits, and D1 makes only one. The second comes from the next release:

1. **D1:** PR `staging → main` (release A). First release: no restore point.
2. **Release B (setup for D2):** this drill log and the release-log entry for A go to `staging` by a docs-only pull request (Matthew or the orchestrator merges it), then PR `staging → main` again. Release B has a restore point (release A's deployment) and a different commit, so the health version tells A and B apart.
3. **D2:** Matthew does Instant Rollback from B to A in the Vercel dashboard. Health must show A's commit again.
4. **D3:** Matthew changes `CRON_SECRET` in Vercel Production, then **Re-run all jobs** on release B's run. The re-run deploys B's commit with the new value and promotes it explicitly. Health must show B's commit: this is the healthy finish.

## Pre-flight (read-only, before D1)

| Check | Result |
|---|---|
| `release.yml` environment and names against `infra/environments.json` | match: secrets `VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`; variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; repo variable `PRODUCTION_URL`; environment `production` |
| Production URL in the docs | `https://northside-quotes.vercel.app` in `infra/environments.json`, `docs/runbook.md`, `docs/ops/account-setup.md`, the operator sops |
| Migrations that will apply | 10 files, `20261120000100` to `20261125001000` (names in the PR body, `docs/deployments/release-1-pr-body.md`); the production database is empty, so all 10 apply; 0800 is guarded; the only extension is `pgcrypto` |
| First release (no previous deployment) | handled: lookup of the production address answers 404 → `first=true`, rollback steps skipped, "First release failed" step explains, summary says "none (first release)" |
| Local checks | `env-check --manifest-only` passes (one warning: `SITE_URL` not named in `src/`); `smoke.mjs --self-test` 9 of 9 |
| **BLOCKER** | `GHL_LOCATION_ID` is `required` for Production in the manifest but is not set in Vercel Production. `env-check --vercel` (first release step) will report `missing: GHL_LOCATION_ID not set for production` and stop the run before any change. |

## D1. Release (first release)

**Steps**

1. Matthew resolves the blocker above, then opens and merges the pull request `staging → main` (required checks green).
2. The merge starts the `release` run and it waits for approval. Matthew: Actions → `release` → the run → **Review deployments** → tick `production` → **Approve and deploy**.
3. DevOps reads the run, then runs `node scripts/smoke.mjs https://northside-quotes.vercel.app <commit sha>` and reads `/api/health`.

**Expected, in order**

| Step | Expected |
|---|---|
| Waiting | the run sits at "Waiting" until approval; nothing is readable before it |
| Configuration is complete | green |
| Environment drift check | `✓ environments match the manifest (including Vercel)` |
| Restore point | notice "No production deployment is live at northside-quotes.vercel.app: this is the first release" |
| Pull the production settings | green |
| Database to migrate is the one the app uses | "Database project epwbzhezitsknqtuykgv matches the production app's Supabase URL." |
| Migrations | pending list shows all 10 versions with an empty remote column, then `migration up` applies them; no line shows the database address |
| Build and deploy (not yet live) | green, a deployment address is printed |
| Promote | `Promoted dpl_… (host).` |
| Smoke | `✓ /api/health — 200 ok, version <first 7 characters of the commit>`, `✓ /`, `✓ /sign-in` |
| Rollback, first-release-failed, smoke-after | all skipped |
| Summary | "Restore point: none (first release …)", promoted success, smoke success |

**After approval DevOps checks:** health reports the released commit; smoke 3 of 3; the migrations list in the summary; the deployment id for the release log.

**Result rows**

| Date | Run link | Commit | Result | What happened | Fix (project / kit template) |
|---|---|---|---|---|---|
| | | | | | |

## D2. Instant Rollback

**Setup:** release B has run and passed (restore point = release A's deployment; summary shows A's commit and deployment id). Note both commits and both deployment addresses here before starting.

**Steps (Matthew)**

1. Vercel → project `northside-quotes` → Deployments. Find the Production deployment from release A (not the current one).
2. **⋯ → Instant Rollback**, confirm.
3. Tell DevOps. DevOps runs `node scripts/smoke.mjs https://northside-quotes.vercel.app <commit of A>`.

**Expected**

| Check | Expected |
|---|---|
| Vercel | deployment A is marked as the current production deployment; a banner or note says production is rolled back and new deployments do not take the domain by themselves |
| Health | `200 ok`, version = release A's commit (not B's) |
| Smoke | all three paths 200 |
| Time | the change is visible within about a minute, with no rebuild |

**Result rows**

| Date | A (commit, deployment) | B (commit, deployment) | Result | What happened (time to switch, what the dashboard said) | Fix |
|---|---|---|---|---|---|
| | | | | | |

## D3. Secret rotation, finishing on a healthy release

**Secret rotated:** `CRON_SECRET` (production). Its effect is visible by itself: the scheduled call must succeed on the new value, and nothing else depends on it (no form tokens, no sessions). Steps follow `docs/sops/operator/rotate-app-secrets.md`; whatever differs in practice goes back into that sop.

**Steps (Matthew unless noted)**

1. Create a new value on your computer (`openssl rand -hex 32 | tr -d '\n'; echo`), save it in the password manager. 64 characters, nothing after the last one.
2. Vercel → project → Settings → Environment Variables → `CRON_SECRET` → the **Production** row → replace the value, keep **Sensitive**. Do not touch the Preview row.
3. DevOps: `node scripts/env-check.mjs --vercel` with the release token reports no difference (names, targets, types only).
4. Observation before redeploying (optional): Vercel → Cron Jobs → run `housekeeping` once. Expected: 401 in Logs, because the running deployment still holds the old value. Record what happened.
5. GitHub → Actions → the `release` run of release B → **Re-run all jobs** → approve under **Review deployments**.
6. Vercel → Cron Jobs → run `housekeeping` once more; Logs show status 200.
7. DevOps: `node scripts/smoke.mjs https://northside-quotes.vercel.app <commit of B>`.
8. Matthew: the old value is gone from Vercel (it was replaced in step 2); record the rotation date in the password manager.

**Expected**

| Check | Expected |
|---|---|
| Re-run, restore point | the deployment live at that moment (release A's, after D2) with its commit |
| Migrations | none pending (the list is empty; `migration up` changes nothing) |
| Deploy and promote | a new deployment of B's commit is promoted explicitly, although D2 left production rolled back |
| Smoke | health version = B's commit (proves the promote took the domain back); 3 of 3 paths 200 |
| `housekeeping` | 200 after the re-run |
| Finish | production healthy on release B's commit with the new secret |

**Result rows**

| Date | Run link | Result | What happened (step 4 observation, button names that differed from the sop) | Fix (project / kit template) |
|---|---|---|---|---|
| | | | | |

## Attempts (all drills, newest first)

| Date | Drill | Version | Result | What happened | Fix (and where it went: project / kit template) |
|---|---|---|---|---|---|
| | | | | | |

## Planted breaks (must be reverted)

None planned in this round.

| Drill | Change | Reverted in |
|---|---|---|
| | | |
