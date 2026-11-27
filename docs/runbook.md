# Runbook: Northside quote requests

Owner: bl-devops (kept current at every release). Steps marked **Matthew** need his accounts: agents hold no production credentials and never deploy, roll back, migrate or change variables in production.
This is a rehearsal with a fake client (Northside Plumbing (TEST)): throwaway accounts, $0 spend limit, no real customer data.

## At a glance

| | |
|---|---|
| Production | `https://northside-quotes.vercel.app` · Vercel team `baseleap`, project `northside-quotes` (Montréal, `yul1`) · Supabase `Northside production` (ca-central-1) |
| Staging | `https://northside-quotes-git-staging-baseleap.vercel.app` (branch address of `staging`; confirm the team slug in Vercel → Deployments) · Supabase `Northside staging` (ca-central-1) |
| Repository | `westmatty92-alt/northside-quotes`, **public** (Matthew's choice, replacing the "private" in `docs/ops/account-setup.md`, decision D-2 option a). Branches `main` (production) and `staging` |
| Health | `GET /api/health` returns `{ "status": "ok", "version": "<commit sha>" }` |
| Smoke check | `node scripts/smoke.mjs <base-url> [commit-sha]` (read-only; exit 0 only when health is 200 and every path in `infra/environments.json` is 200) |
| Logs | Vercel → project → Logs; filter by `request_id` (the `x-vercel-id` of a failing response). Log lines carry ids and outcomes only, never personal data |
| Uptime | GitHub Actions `uptime` (every 30 minutes) opens one issue labelled `uptime` while production is down |
| Release log | `docs/deployments/release-log.md` (created by the first release) |
| Pipeline drills | `docs/ops/pipeline-drills.md` |

Public-repository reminders: never commit a value (names only; `.env.example` has names), and treat every Actions log as public. The release and migration steps drop any line that shows the database address, and GitHub masks the secret values.

## Environments and where each setting lives

| Branch | Vercel | Supabase | Who deploys it |
|---|---|---|---|
| `main` | Production | `Northside production` | only `release.yml`, after Gate 3 and Matthew's approval. Git deploys of `main` are off (`vercel.json`) |
| `staging` | Preview (the branch address is the staging URL) | `Northside staging` | Vercel's Git integration on every push; `qa-smoke` checks it |
| `lane/*` | Preview | `Northside staging` (shared) | Vercel's Git integration |

`infra/environments.json` is the list of record for every variable name and where it lives (Vercel Production and Preview, GitHub `staging`, GitHub `production`, the orchestrator's `.env.local`). `node scripts/env-check.mjs --manifest-only` proves it matches the code, `.env.example` and the workflows; `node scripts/env-check.mjs --vercel` (needs `VERCEL_TOKEN` and `VERCEL_PROJECT_ID`; `release.yml` runs it) checks Vercel by name, target and type only, never values.

## Deploy (normal release)

Preconditions (DevOps confirms all before opening the PR): Gate 3 `release_approval` approved; the reviewer and security verdicts are APPROVED and QA is PASS on the exact `staging` commit; the migrations to apply are named in the Gate 3 packet; the drill log shows release and rollback passed (`docs/ops/pipeline-drills.md`).

1. DevOps opens a pull request `staging` to `main` with the Gate 3 summary, the migration list and the rollback plan, waits for the required checks (`verify`, `api-tests`, `security`, `workflows`) and merges. **Never merge with a check red** (release 1 was merged with `verify`, `api-tests` and `security` failing because no ruleset on `main` stopped it; the ruleset below does).
2. The merge starts `release.yml`. Its first job, the **pre-flight** (below), must pass by itself; it fails the run before any approval is asked for if production is not protected. **Matthew:** GitHub → Actions → `release` → the waiting run → **Review deployments** → tick `production` → **Approve and deploy**. Nothing live changes before this.
3. The workflow then: checks Vercel variable names (drift check) → records the production deployment that is live now (the restore point) → pulls production settings and proves the database string is for the project the production app uses → lists pending migrations and applies them to the production database → builds and deploys without assigning the domain → promotes → smoke (health must report this commit, every smoke path 200).
4. If the promotion or the smoke fails, it promotes the recorded deployment back by itself (Instant Rollback), checks that the previous commit answers, and marks the run failed. Migrations stay applied (they are expand/contract, so the previous version still works).
5. DevOps reads the run, appends the entry to `docs/deployments/release-log.md` (via a pull request to `staging`) and updates this runbook.

**Release pre-flight (first job of `release.yml`, added after release 1, Nov 27).** Release 1 started without waiting for anyone because the `production` environment had no required reviewer and administrators could bypass it; it stopped only because `PRODUCTION_URL` was unset. The pre-flight reads GitHub's own description of the environment (read-only, `GET /repos/{owner}/{repo}/environments/production` and `.../deployment-branch-policies`, token permission `actions: read`) and fails the run unless: the required reviewers include `westmatty92-alt` (from `infra/environments.json`), *Allow administrators to bypass* is off (`can_admins_bypass` is `false`), deployments are limited to the branch `main` ("Selected branches", not "All" or "Protected branches only"), and the repository variable `PRODUCTION_URL` is set to an https address. It fails the run in about ten seconds with the reason in the run summary; fix the setting and push or re-run. Proof it rejects each bad setup: `node .github/scripts/release-preflight.mjs --self-test` (also run by the `workflows` check). It cannot see the environment's own secrets and variables (`VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`); the first job after the approval still checks those are set. If the pre-flight reports **GitHub refused the workflow token (HTTP 403 or 404)**: Matthew creates a fine-grained personal access token for this repository only with repository permission **Actions: Read** (nothing else), and saves it as the **repository** secret `RELEASE_PREFLIGHT_TOKEN` (Settings → Secrets and variables → Actions → Repository secrets; not in the `production` environment, whose secrets cannot be read before the approval). The workflow uses it automatically when it exists.

**First release only.** A new project has no live production deployment (the failed import build is never aliased), so there is no restore point: the workflow allows that once (HTTP 404 on the lookup, and only then), says so in the summary, and cannot roll back because nothing was live. A failed first release is Matthew's call (see Incidents).

**Re-running with new variables.** Vercel keeps the old values until the next deployment. After changing a production variable (rotation), re-run the latest `release` run (Actions → the run → **Re-run all jobs**; it needs approval again). It redeploys the same commit with the new values.

## Roll back

- **App, automatic:** `release.yml` does it when a release fails its smoke check (above).
- **App, manual (Matthew):** Vercel → project → Deployments → the last good Production deployment → **⋯ → Instant Rollback**. On Vercel's side this stops new production deployments from taking the domain until one is promoted; the next release promotes explicitly, so it keeps working. Command-line equivalent on Matthew's machine: `vercel rollback <deployment-url>`; undo with `vercel promote <deployment-url>`.
- **Database:** no down-migrations. Migrations are expand/contract, so the previous app version works on the new schema; a problem is fixed with a new forward migration through the normal flow. Lost or damaged data: the Supabase Free plan has no point-in-time recovery or downloadable backups, so for this rehearsal the answer is to recreate the data from the migrations and accept the loss; **Matthew** decides.
- After any rollback, check production with `node scripts/smoke.mjs https://northside-quotes.vercel.app`.

## Platform settings (not in code; verify before each release)

Last verified: not yet. OPS1 had no read access (no `gh` API call, no Vercel token); the first pipeline step with credentials verifies each row read-only (`gh api`, the Vercel API, the dashboards) and records the date here.

| Setting | Expected |
|---|---|
| GitHub: repository | public; **Actions → General → Workflow permissions** read-only; fork pull-request workflows need approval for outside contributors; Actions spending limit $0; push protection and secret scanning on (free on public repos) |
| GitHub: ruleset on `main` | pull request required; required checks `verify`, `api-tests`, `security`, `workflows`; force pushes blocked; deletions restricted; empty bypass list. Set by Matthew after the first checks have run (account-setup Part 7, step 7) |
| GitHub: environment `staging` | no reviewers. Secrets (all required by `api-tests`, which stops with the missing names if one is absent): `VERCEL_AUTOMATION_BYPASS_SECRET`, `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_ANON_KEY`, `SUPABASE_STAGING_SERVICE_ROLE_KEY`, `SUPABASE_STAGING_DB_URL`, `QA_OWNER_PASSWORD`, `QA_HELPER_PASSWORD` (the real sign-in tests use the two passwords). Variables: `SUPABASE_STAGING_REF`, `PRODUCTION_HOSTS`. Optional: `QA_OWNER_EMAIL`, `QA_HELPER_EMAIL` |
| GitHub: environment `production` | required reviewer `westmatty92-alt` (self-review allowed because one account starts and approves a release in this rehearsal); *Allow administrators to bypass* **off**; deployment branches **Selected branches: `main` only**. Secrets: `VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`. Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Nothing else: no Supabase personal access token, no database password, no project ref. **Checked by the release pre-flight on every release (it fails the run before the approval if any of the first three is wrong)** |
| GitHub: repository variable | `PRODUCTION_URL` = `https://northside-quotes.vercel.app` (the pre-flight fails the run when it is empty) |
| GitHub: repository secret (optional) | `RELEASE_PREFLIGHT_TOKEN`: only if the pre-flight reports GitHub refused the workflow token; fine-grained, this repository only, **Actions: Read** and nothing else |
| Vercel: Git | production branch `main`; `deployment_status` events on (the staging checks start from it); Git deploys of `main` off (`vercel.json`) |
| Vercel: Functions | region Montréal (`yul1`); Hobby cron: 5 daily entries from `vercel.json` (four `ghl-sync`, one `housekeeping`); they run on Production only |
| Vercel: protection | Standard Protection with Vercel Authentication (previews protected, production public); Protection Bypass for Automation on; Password Protection, Passport and Trusted IPs **off** (paid); no custom domain |
| Vercel: variables | exactly the rows in `infra/environments.json`, secrets stored as **Sensitive**, Preview rows on *All Preview Branches*; *Automatically expose System Environment Variables* on. `node scripts/env-check.mjs --vercel` reports any difference |
| Supabase (both projects) | region ca-central-1; **Authentication → Sign In / Providers**: sign-up off, anonymous sign-ins off, Email provider on, no other provider; **Providers → Email**: minimum password length 12 and *Require reauthentication when changing password* on; **Authentication → Emails → SMTP settings**: default sender, **no custom SMTP**; Storage bucket `quote-photos` made by the migrations (private), none by hand; URL Configuration: Site URL and redirect `<address>/**` of that environment |
| Supabase: production database | the Session pooler string (host in ca-central-1, port 5432) is the only database credential outside Supabase and lives only in GitHub `production` |

## Staff accounts and passwords (ruling 3A)

The app has no sign-up, no password change, no forgot-password link and sends no email. Baseleap creates the two accounts (owner and helper), sets each password and hands it over by phone.

**Rules for every password Baseleap sets or resets:** at least 12 characters, a different password per account, generated by the password manager and saved there as `Northside (TEST) · <environment> · <owner or helper> password`; never in chat, email, a file or a ticket. Supabase's own minimum length (12, set in both projects above) and *Require reauthentication when changing password* are switched on as a second line; whether the dashboard's "create user" form applies the minimum is unverified, so the 12-character rule is Baseleap's procedure either way.

**Register a staff member** (an auth user alone has no access: `is_staff()` is false until a staff row exists):
1. Supabase dashboard → the project → **Authentication → Users → Add user → Create new user**: email, the generated password, **Auto Confirm User** ticked (no confirmation email can be sent).
2. Staging, from the repo on the orchestrator machine: `npm run db:staff-add -- <email> [display name]` (idempotent; `owner` becomes "Owner", `helper` "Office helper" by default). It reads `SUPABASE_STAGING_DB_URL` and refuses a production address by design.
3. Production (**Matthew**; the script above never touches production): Supabase production project → **SQL Editor**, with the real email:
   ```sql
   insert into public.staff (user_id, display_name)
   select id, 'Owner' from auth.users where lower(email) = lower('owner@example.com')
   on conflict (user_id) do nothing;
   ```
   then confirm one row: `select count(*) from public.staff;` returns the number of accounts you made.

**Reset a forgotten password:** Supabase dashboard → **Authentication → Users** → the user → set a new password (12+ characters, new and different from the other account, from the password manager) → tell the owner by phone → record the date in the password manager. Dashboard wording varies by version; if no direct password field is offered, send a screenshot to Baseleap rather than enabling any email-based flow.

**Never configure custom SMTP on these projects without a security review (SEC-10).** Supabase's recovery and one-time-code endpoints exist; they deliver nothing only while no custom SMTP sender exists. With one, a staff member could be signed in by a recovery or code email, and the "reauthentication" nonce would start arriving too. Any request to add an email sender (including for invitations) stops here and goes to the security review and the spend gate first.

## Secrets and rotation (Matthew executes; DevOps prepares)

Order for every secret: **create the new one → store it everywhere listed → redeploy → verify → revoke the old one.** Save each new value in the password manager first. Never paste a value into chat, a file, a ticket or a log.

| Secret | Created in | Lives in (every place) | While rotating | Verify |
|---|---|---|---|---|
| `APP_SIGNING_SECRET` (a different value per environment, 32+ random bytes) | the password manager's generator | Vercel Production row and Vercel Preview row only | form tokens already open stop working (the homeowner just reloads the form); anonymous hash counters restart. DevOps asks before any rotation | re-run release (production) or push staging (preview); `scripts/smoke.mjs`; load `/` and submit a test request on staging |
| `CRON_SECRET` (a different value per environment, 32+ bytes) | the password manager's generator | Vercel Production and Preview rows only (Vercel sends the Production value on every scheduled call) | scheduled calls get 401 until redeployed | redeploy; Vercel → project → Cron Jobs → run `housekeeping` once and check Logs for status 200 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → create a new secret key | Vercel Production (production project's key) and Vercel Preview (staging project's key); for staging also GitHub `staging` as `SUPABASE_STAGING_SERVICE_ROLE_KEY` | server routes fail until redeployed | redeploy; staging `qa-smoke` green; then delete the old key in Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key) | Supabase → API Keys | Vercel Production and Preview; GitHub `staging` as `SUPABASE_STAGING_ANON_KEY` | needs a rebuild (the value is compiled into the page) | redeploy; load `/` |
| Database password and address (`SUPABASE_STAGING_DB_URL`, `SUPABASE_PRODUCTION_DB_URL`) | Supabase → project → Database → Settings → reset the database password; then Connect → Direct → Session pooler (host must contain `ca-central-1`), password filled in the box you paste into | staging string: GitHub `staging` and the orchestrator `.env.local`. Production string: GitHub `production` only (never Vercel, `.env.local` or an agent machine) | migrations and RLS tests cannot connect with the old string; the app is unaffected (it uses API keys) | staging: `npm run db:check`; production: the next release's migration step |
| `VERCEL_TOKEN` (team `baseleap` only, 30 days) | Vercel → Account Settings → Tokens | GitHub `production` only | releases and the drift check fail with the old one after deletion | re-run the latest `release` run (approval needed) or wait for the next release; then delete the old token. Every 28 days |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel → project → Deployment Protection → Protection Bypass for Automation | GitHub `staging`; QA's `.env.local` | staging checks get 401 until updated | push to `staging`; `qa-smoke` green; remove the old secret in Vercel |
| `GHL_PRIVATE_INTEGRATION_TOKEN` (test sub-account, scopes `contacts.readonly` and `contacts.write` only) | GoHighLevel → Settings → Private Integrations | Vercel Production and Preview, Sensitive | contact copies report "failed" and retry later | redeploy; call `/api/jobs/ghl-sync` once with the new setup; then delete the old token in GoHighLevel |
| Staff passwords | the password manager | the Supabase dashboard of that project, and the password manager (`QA_*` names in GitHub `staging` and QA's `.env.local` for the staging logins only) | that person is signed out of new sessions | sign in |

**After a leak:** treat as rotation first, history clean-up second. Rotate every value that could have been exposed in the order above, then ask Baseleap security to remove it from git history. Both are Matthew's actions.

## Health, logs and uptime

- Health: `curl -s https://northside-quotes.vercel.app/api/health` should show `status: ok` and the commit of the last release.
- Logs: Vercel → project → Logs. Search by `request_id`. Cron runs appear under the route names `ghl-sync` and `housekeeping`. Preview deployments have no scheduled runs.
- Uptime: `.github/workflows/uptime.yml` checks production every 30 minutes (a free public-repository schedule; GitHub may delay it, and pauses scheduled workflows after 60 days with no repository activity: push anything or re-enable it under Actions if that happens). While production fails, one issue titled "Production is down" (label `uptime`) collects the output; it closes itself on recovery. It only starts after the first release PR is merged, since schedules run from `main`. No paid uptime service without a spend gate.

## Incidents

1. **Confirm and time-stamp:** run `node scripts/smoke.mjs https://northside-quotes.vercel.app`, open Vercel Logs, note the start time.
2. **If the last release caused it: roll back first, investigate second** (Roll back, above). If the release workflow already rolled back, confirm with the smoke check.
3. **First release failed with nothing to roll back to** (no restore point): production has never served users, so there is no emergency. **Matthew** decides: fix forward through the normal flow (ticket, fix, QA, review, Gate 3), or delete the failed deployment in Vercel.
4. **Find the root cause** from the logs and the diff and route the fix through the normal flow. No hotfix straight to `main`.
5. **Write the entry below** the same day.

### Incident log

| Date | What happened | Detected by | Fixed by | What changes so it does not recur |
|---|---|---|---|---|
| | | | | |

## Rehearsal wrap-up

When the rehearsal ends (Matthew): delete the two Supabase projects and the Vercel project, revoke every token and the throwaway GitHub access, and delete the saved password-manager entries (`docs/ops/account-setup.md`, "Afterwards").
