# Account setup for {{PROJECT}}: the steps only Matthew can do

<!-- bl-devops fills every {{…}} from infra/environments.json and docs/ops/secret-inventory.md,
     deletes rows that don't apply, and saves this as docs/ops/account-setup.md.
     Names only, never values. This is the packet for the `account_setup` gate. -->

This packet sets up GitHub, Supabase and Vercel for **{{PROJECT}}**. It takes about 60 to 90 minutes and needs no coding.
When you're finished, approve the `account_setup` gate. The DevOps step waiting on it then checks everything by name only.

## Read this first

- **Copy secrets tab to tab:** copy the value on one site and paste it straight into another site's settings box. Never paste one into chat, email, a note, a file or a screenshot.
- **Save each secret in the password manager** as `{{CLIENT}} · <Service> · <Purpose>`.
- **If a page says Upgrade or shows a price, stop.** That's a spend decision. Open a `spend_approval` gate instead.
- **If a menu isn't where this says,** send a screenshot with the value boxes blank.
- **Turn on two-step login** on all three accounts.

| This build | |
|---|---|
| Account owner (decided at kickoff) | {{OWNER: client-owned with Baseleap as admin / Baseleap-owned team}} |
| GitHub repo | `{{OWNER_ORG}}/{{REPO}}` (**private**) |
| Vercel team / project | `{{VERCEL_TEAM}}` / `{{VERCEL_PROJECT}}`, region Montréal (yul1) |
| Supabase projects | `{{CLIENT}} staging` and `{{CLIENT}} production`, Canada (Central). Two projects, never shared |
| Production address | `https://{{PRODUCTION_DOMAIN}}` |
| Staging address | `https://{{VERCEL_PROJECT}}-git-staging-{{VERCEL_TEAM_SLUG}}.vercel.app` (Vercel's branch address: project name, `-git-staging-`, team slug. Confirm in step 3.5) |

## Part 1: GitHub
1. Create the repo `{{REPO}}`: **Private**, empty. Add the Baseleap account as **Admin** if the client owns it.
2. Go to **Settings → Actions → General → Workflow permissions** and choose **Read repository contents**. Click **Save**.
3. Go to **Settings → Code security**. Turn **Push protection** on if it's free; skip it if it shows a price.
4. Tell us the repo exists. DevOps then pushes the code, the workflows and `staging`.

## Part 2: Supabase (do 2.1 to 2.3 for staging, then for production)
1. **New project.** Name it `{{CLIENT}} staging` (then `{{CLIENT}} production`) in region Canada (Central). Generate the database password and save it in the password manager **before** creating the project. Leave automatic RLS on. Note the project ref (it's in the address bar).
2. **Keys.** Copy the **Project URL** from Project Settings → Data API, and the **Publishable** and **Secret** keys from Project Settings → API Keys. They go into Vercel in Part 3.
3. **Authentication → URL Configuration.** Set the Site URL and a redirect URL `<address>/**`. Production uses `https://{{PRODUCTION_DOMAIN}}`. Staging uses the staging address from 3.5.
4. **Staging database address** (for the staging-migrations workflow; never an access token in `staging`): in the **staging** project, click **Connect** (top of the page) → **Direct · Connection string** (not "Framework") → **Session pooler** (not Direct connection or Transaction pooler). Copy the URI (`postgresql://postgres.<staging ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`) and paste it into GitHub → **staging** → secret `SUPABASE_STAGING_DB_URL`, replacing `[YOUR-PASSWORD]` (brackets included) with the staging database password, in that box. Supabase access tokens reach every organization you belong to, so they never go into `staging`.
5. **Access token** (account level, one per build, production only): name `{{REPO}}-release`, expiry 30 days, permissions limited to migrations and project read for this organization. Save it in the password manager; it goes into GitHub production only. Add a calendar reminder 28 days out.

## Part 3: Vercel
1. In team `{{VERCEL_TEAM}}`, click **Add New → Project** and import `{{REPO}}`. A failed first deploy is fine.
2. Go to **Settings → Environments** and add each row below. Production rows use the production Supabase project; Preview rows use staging. Leave Development empty.

| Name | Production | Preview | Type |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | production Project URL | staging Project URL | Config |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production Publishable key | staging Publishable key | Config |
| `SUPABASE_SERVICE_ROLE_KEY` | production Secret key | staging Secret key | **Sensitive** |
| `SITE_URL` | `https://{{PRODUCTION_DOMAIN}}` | the staging address above | Config |
{{ONE ROW PER PROVIDER KEY FROM docs/ops/secret-inventory.md: live key in Production, test/sandbox key in Preview, Sensitive}}

   **Tick Production and Preview** for every row that needs both, with the branch on **All Preview Branches**. Lane previews need them too; a Preview copy limited to `staging`, or a Production-only row, fails the release's drift check.

   **One name, two rows.** A name with different values per environment (like `SITE_URL`) is two separate rows: one ticked Production only, one ticked Preview only. If a row already covers both, edit it down to Production first, then add the Preview row. Vercel refuses a second row whose environments overlap.

3. Check four settings: under **Environment Variables**, *Automatically expose System Environment Variables* is ticked; **Git → Production Branch** is `main`; **Functions → Region** shows Montréal (yul1); **Git → deployment_status Events** is **on** (the staging tests start from it; without it, they never run).
4. Go to **Deployment Protection**. Vercel Authentication should be on. Under **Protection Bypass for Automation**, click **Add Secret** and copy it. It goes into GitHub staging.
5. **Staging address.** It's already filled in above. Once DevOps has pushed `staging`, confirm it under **Deployments → filter `staging` → Domains**. If it differs, use the one Vercel shows and tell DevOps.
6. **IDs (not secret):** Team ID (`team_…`) and Project ID (`prj_…`), both under **Settings → General**.
7. **Release token:** go to **Account Settings → Tokens**. Name `{{REPO}}-release`, scope team `{{VERCEL_TEAM}}` only, expiry 30 days.
8. **Domain:** go to **Settings → Domains** and add `{{PRODUCTION_DOMAIN}}`. Send the DNS records to {{DNS_OWNER}}, then wait for the green check.

## Part 4: GitHub environments
Go to **Settings → Environments**.

**`staging`** (no reviewers):

| Kind | Name | Value |
|---|---|---|
| Secret | `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel 3.4 |
| Secret | `SUPABASE_STAGING_URL` | staging Project URL |
| Secret | `SUPABASE_STAGING_ANON_KEY` | staging Publishable/anon key |
| Secret | `SUPABASE_STAGING_SERVICE_ROLE_KEY` | staging Secret/service_role key |
| Secret | `SUPABASE_STAGING_DB_URL` | staging session-pooler URI with the password (Part 2, step 4) |
| Variable | `SUPABASE_STAGING_REF` | staging project ref |
| Variable | `PRODUCTION_HOSTS` | `{{PRODUCTION_DOMAIN}}` |

**`production`**: set the deployment branch to `main` only. Untick *Allow administrators to bypass*. {{APPROVAL: until the Console approval exists, releases on this private repo are started only by you, using **Actions → Release → Run workflow**. The workflow refuses anyone else. Leave Required reviewers empty.}}

| Kind | Name | Value |
|---|---|---|
| Secret | `VERCEL_TOKEN` | Vercel 3.7 |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase 2.4 |
| Secret | `SUPABASE_DB_PASSWORD` | production database password |
| Variable | `VERCEL_ORG_ID` | Team ID |
| Variable | `VERCEL_PROJECT_ID` | Project ID |
| Variable | `SUPABASE_PRODUCTION_REF` | production project ref |

**Repo variable** (Settings → Secrets and variables → Actions → Variables): `PRODUCTION_URL` = `https://{{PRODUCTION_DOMAIN}}`.

**Protect `main`:** do this after we tell you the first checks have run. Add a branch ruleset on `main` that requires a pull request and the checks `verify`, `security` and `workflows`, blocks force pushes and restricts deletions. Leave the bypass list empty.

## Part 5: Checklist, then approve the gate

| ✓ | Where | What |
|---|---|---|
| ☐ | Supabase | two projects, keys copied, URL configuration on both, access token |
| ☐ | Vercel | every row of the table, in Production and Preview, with the right type |
| ☐ | Vercel | system variables exposed, production branch `main`, region yul1, bypass secret, domain verified |
| ☐ | GitHub `staging` | bypass secret, `PRODUCTION_HOSTS` |
| ☐ | GitHub `production` | 3 secrets, 3 variables, `main` only, no admin bypass |
| ☐ | GitHub | `PRODUCTION_URL`; workflow permissions read-only |
| ☐ | Password manager | every secret saved; reminders set for both tokens |

Then approve the gate from your own signed-in session: `node scripts/stack-ledger.mjs gate resolve account_setup --approve`.
DevOps then runs `node scripts/env-check.mjs --vercel`, which compares names only and never reads values, and tells you anything still missing.

After you change any Vercel variable, the running deployment keeps the old value until it's redeployed. DevOps redeploys staging; production only changes through a release.

## Afterwards
- **Every 28 days:** new Vercel and Supabase tokens go into GitHub production, then delete the old ones.
- **When someone leaves or the contract ends:** remove access the same day and rotate any key they could see.
