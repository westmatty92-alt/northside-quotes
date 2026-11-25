# Rotate an app secret

**Purpose:** Replace one secret with a new one, in every place it lives, without an outage, and then revoke the old one.
**Who:** Matthew executes. DevOps prepares and asks first · **When:** On a schedule (the Vercel release token every 28 days, the GoHighLevel token every 90 days), after a leak, or when a person who knew a secret leaves · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#rotate-app-secrets)

**DRAFT.** No rotation has been drilled. DEP1 rotates one secret after Gate 3. Until then the steps that name a dashboard page or a button are unverified. This page names secrets only. It never holds a value.

## Before you start
- Rotation order never changes: create the new value, store it in every place listed, make a new deployment, check, then revoke the old value.
- Save each new value in the password manager first. Never paste a value into chat, a file, a ticket or a log.
- A running deployment keeps its old values. A new deployment is needed after any change. On Preview, push a new commit to `staging` or ask DevOps to redeploy. On Production, re-run the latest `release` run. Do not use Vercel's Redeploy button on Production.
- `APP_SIGNING_SECRET` and `CRON_SECRET` need 32 or more characters. Each environment gets its own value, and the two names never share one. Nothing follows the last character, no space and no line break. A trailing space in `CRON_SECRET` broke the staging Preview build with `INVALID_CRON_SECRET`.
- Names and where each lives:

| Secret | Lives in | While you rotate | How to check |
|---|---|---|---|
| `APP_SIGNING_SECRET` | Vercel Production and Preview | Form pages already open stop working, and the homeowner reloads. Anonymous counters restart. | Load the home page, then send a test request on staging |
| `CRON_SECRET` | Vercel Production and Preview | Scheduled calls are refused until the new deployment is live | Vercel, **Cron Jobs**, run `housekeeping` once, then check **Logs** for status 200 |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel Production and Preview. For staging, also GitHub `staging` as `SUPABASE_STAGING_SERVICE_ROLE_KEY` | Server routes fail until the new deployment is live | The staging `qa-smoke` check is green. Then delete the old key in Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel Production and Preview. GitHub `staging` as `SUPABASE_STAGING_ANON_KEY` | Needs a rebuild, because the value is built into the page | Load the home page |
| `SUPABASE_STAGING_DB_URL` and `SUPABASE_PRODUCTION_DB_URL` | Staging: GitHub `staging` and the orchestrator's `.env.local`. Production: GitHub `production` only | Migrations and database tests cannot connect with the old value. The app is not affected. | Staging: `npm run db:check`. Production: the next release's migration step |
| `VERCEL_TOKEN` | GitHub `production` only | Releases fail with the old one after it is deleted | Re-run the latest `release` run. Every 28 days |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub `staging`, and QA's `.env.local` | Staging checks get 401 until updated | Push to `staging`. The `qa-smoke` check is green |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Vercel Production and Preview, as Sensitive | Copies to GoHighLevel show failed and retry later | Trigger `ghl-sync` once. Delete the old token in GoHighLevel inside its 7-day overlap |

## Steps
1. Choose the secret from the table. Read the "While you rotate" cell. For `APP_SIGNING_SECRET`, ask Matthew first.
2. Create the new value where the secret comes from. For `APP_SIGNING_SECRET` and `CRON_SECRET`, use the password manager's generator, or `openssl rand -hex 32` on your own computer. For the others, use the matching dashboard: Supabase **Project Settings → API Keys**, Vercel **Account Settings → Tokens**, or GoHighLevel **Private Integrations**. ⚠ unverified: the dashboard page names are from the runbook and were not followed in a drill.
3. Save the new value in the password manager.
4. Paste it into every place in the "Lives in" column. In Vercel, open the project, then **Settings**, then the environment variables, and set the row to **Sensitive**. Put Production and Preview values in their own rows. After you paste, press End and check that nothing follows the last character. ⚠ unverified: the Vercel menu names, from the account-setup packet only.
5. Run `node scripts/env-check.mjs --vercel`. It needs `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` in your environment. It compares names only, never values. It must report no difference.
6. Make a new deployment. Preview: push a commit to `staging`. Production: open GitHub, then **Actions**, then the latest `release` run, then **Re-run all jobs**, and approve it again. ⚠ unverified: the button names, until the release drill has run.
7. Check the secret as the table says. Look for status 200 or a green check.
8. Revoke the old value in the place it came from: delete the old key, token or secret there.
9. In the password manager, record the date.

## What you should see
- The check in the table passes after the new deployment.
- The old value no longer works.

## If it goes wrong
- **The Preview build fails with `INVALID_CRON_SECRET`:** The `CRON_SECRET` has a space or a line break at the end. Paste it again with nothing after the last character, and make a new deployment.
- **Scheduled calls get 401 after the change:** The new deployment is not live yet. Make one (step 6).
- **Staff checks get 401 after a bypass-secret change:** The GitHub `staging` value does not match the Vercel one. Update GitHub, then push to `staging`.
- **Copies to GoHighLevel stay failed after a token change:** Make a new deployment, then follow [recover-failed-ghl-syncs.md](recover-failed-ghl-syncs.md).
- **A value was pasted into chat, a file or a log:** Rotate it now in this order. Then ask Baseleap security to clean the git history. Both are Matthew's actions.
- **You are not sure where a secret lives:** Look at `infra/environments.json`. It lists every name and its home. Do not guess.

## Changelog
- 2026-11-25 — First version, a draft from the runbook table and the account-setup packet, including the `INVALID_CRON_SECRET` lesson from staging. No rotation drill has run yet — step DOC1
