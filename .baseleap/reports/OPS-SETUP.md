# STEP OPS-SETUP — Account-setup packet for Matthew (GitHub, Vercel, Supabase ca-central-1, env var names)
## Attempt 1 — 2026-11-19
**Status:** done (one verify command not run by me, see Commands run)
**Files changed:** `docs/ops/account-setup.md` — the packet, written from the ops-environments account-setup template and the locked inputs.
**Read:** `.claude/skills/ops-environments/templates/account-setup.md` and `environments.json`, `.baseleap/plan-blueprint.json` (the OPS-SETUP entry), `.baseleap/inputs/intake.md`, `.baseleap/brief.md`, `docs/PRD.md`, `PLAN.md`, `.env.example`, `.gitignore`. I did not open `.env.local` or any other `.env*` file. External, read-only: Vercel docs pages on deployment protection, protection bypass for automation, regions, and cron limits.

**Acceptance criteria:**
- Account | Owner | Created by | Recurring cost table covers GitHub, Vercel, Supabase and GHL → "Accounts, owners and costs" table in the packet (7 rows; the Supabase staff accounts and the production project each have their own row).
- ca-central-1 stated for every Supabase resource → stated in the summary table, Part 2 step 1 (project, and that Storage and the photo bucket share the region), Part 2 step 5 (pooler host check) and Part 7 step 1 (production). `grep -c` finds 8 mentions.
- SUPABASE_STAGING_DB_URL and SUPABASE_ACCESS_TOKEN listed for the orchestrator machine → Part 6 table, with the note that they go in `.env.local` and not in Vercel or GitHub.
- Only env var names appear → inspected by hand; the packet holds names, placeholders such as `[YOUR-PASSWORD]` and `<staging ref>`, and no values. The ledger's secret-pattern grep was not run by me (below).
- No template placeholders remain → `grep -c '{{'` returns 0.

**Commands run:**
- `git remote -v; git branch -a` → exit 0; no remote exists and only `main` exists (the packet's Part 1 step 6 adds the remote and pushes `main` and `staging`).
- `grep -c '{{' docs/ops/account-setup.md` → 0.
- `grep -c 'ca-central-1'` → 8. `grep -c 'SUPABASE_STAGING_DB_URL'` → 4. `grep -c 'SUPABASE_ACCESS_TOKEN'` → 3. `grep -c 'Account | Owner | Created by | Recurring cost'` → 1.
- `test -s docs/ops/account-setup.md` equivalent: `wc -c` → 21916 bytes.
- The secret-pattern `grep -En 'eyJ…|sb_secret_…|…'` verify line → **not run: the permission system denied it twice** (as part of a compound command and on its own). I did not try another way around it. Unverified by me; the ledger's independent run will decide. By inspection, nothing in the file resembles a token or key.

**Findings that shaped the packet:**
1. **Vercel preview protection and bypass cost nothing.** Vercel docs: Protection Bypass for Automation "is available on all plans" (https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation, dated 2026-09-16). Standard Protection with Vercel Authentication is available on all plans with no add-on (https://vercel.com/docs/deployment-protection, dated 2026-09-15). Paid and avoided: Password Protection ($20/month per project, not on Hobby), Passport and Trusted IPs (Enterprise). No DECISION line is needed for this. **Unverified:** the `baseleap` team's own plan, because I hold no Vercel credentials; it doesn't change the result.
2. **Region:** Vercel's region list maps `yul1` to Montréal / `ca-central-1`, so the template's region line holds.
3. **Hobby cron is once per day** (https://vercel.com/docs/cron-jobs/usage-and-pricing). That fits the PRD's "retry at least every 24 hours" and nothing faster. For the architect (A1) if the team is on Hobby.
4. **Production within $0:** a second free Supabase project in the same org, region, with D-1 as the fallback. The "2 active free projects per organization" limit is from background knowledge; the Supabase docs fetch was denied. Unverified.
5. **GitHub Free and private repos:** environments, required reviewers and rulesets may be limited on private repos for free accounts. Background knowledge only; the GitHub docs fetch was denied. The packet has Matthew check on the actual pages (Part 1 step 4) and carries D-2 if it shows a price. This matters because the whole release flow depends on GitHub environments.
6. **GitHub Actions minutes:** a private Free repo gets a limited monthly allowance (2,000 minutes, unverified). The standard `uptime.yml` runs every 15 minutes, which is about 2,880 runs a month and would use more than that if each run bills a minute. Later pipeline step: lower the uptime frequency (or settle D-2 first) so no spend is needed.

**Could not do:**
- Read the team's Vercel plan, the sandbox org's current Supabase project count, or GitHub's plan limits (no credentials, and two doc fetches were denied). Each is a check Matthew makes in the packet, with the stop-and-decide rule.
- Run the secret-pattern verify line (denied).

**CONTRACT QUESTION:** none.
**BLOCKED:** none for this step. The packet itself needs Matthew (see below). Names reserved for later setting requests, not requested now: `GHL_PRIVATE_INTEGRATION_TOKEN` (scopes per docs/integration-contract.md, Credentials and scopes, which A1 has not written yet).

**Notes for the next step:**
- A1 / A2: the staging project is `Northside staging`, ca-central-1; the app's staging variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL` (Vercel Preview). A2's verify needs `SUPABASE_STAGING_DB_URL` and `SUPABASE_ACCESS_TOKEN` in the orchestrator machine's `.env.local`. Storage buckets are not created by hand, so A1's migrations must create the private photo bucket on both projects (as the plan already says).
- A1: if the retry design needs a cron secret, name it (`CRON_SECRET` in the template manifest) so DevOps can send a setting request. It is deliberately not in the packet.
- Staff accounts (owner and helper) are created by Baseleap, not by Matthew. Whoever does it needs a script that uses the staging service key with no email sent. Their E2E credential variable names are not defined yet (QA / backend); they come later through ops-secrets.
- DevOps (later step): `infra/environments.json` must add `SUPABASE_STAGING_DB_URL` to the GitHub `staging` secrets (the template manifest lacks it, the account-setup template has it); the production hostname is `northside-quotes.vercel.app` (assumed, to be confirmed by Matthew in Part 3 step 9), and the staging address assumes team slug `baseleap`.
- First import into Vercel triggers one production build from Git before `vercel.json` can turn that off. It will fail (no app) and affects no one. Noted in the packet.
- The packet puts Matthew as required reviewer of the GitHub `production` environment (ops-release §2), with self-review allowed because one account does both in the rehearsal. The template's alternative (no reviewers, workflow refuses anyone else) was not used.

## Gate summary (paste into the `account_setup` packet)

**Accounts, who creates each, cost** (all throwaway, all $0 at the $0 spending limit):
- GitHub `westmatty92-alt`, repo `northside-quotes` (private; branches `main` and `staging`): Matthew creates the repo and pushes both branches. $0.
- Vercel team `baseleap`, project `northside-quotes` (Montréal, `yul1`): Matthew creates the project. $0. Preview protection and the automation bypass are free on every plan (Vercel docs, 2026-09-15 and 2026-09-16). The team's own plan is unverified.
- Supabase `Northside staging`, ca-central-1 (new, free, sandbox org): Matthew. $0. Public sign-up off; no Storage bucket by hand (migrations create it).
- Supabase `Northside production`, ca-central-1: Matthew, later, before the pipeline drills. $0 if the dashboard allows another free project.
- Supabase staff accounts (owner, helper): Baseleap, after the migrations, no email sent. $0.
- GoHighLevel test sub-account: already exists; nothing to create now. Token variable `GHL_PRIVATE_INTEGRATION_TOKEN` is requested later, with scopes per docs/integration-contract.md, Credentials and scopes.
- Orchestrator machine `.env.local`: `SUPABASE_STAGING_DB_URL`, `SUPABASE_ACCESS_TOKEN` (names only; not in Vercel).

**Costs as DECISION lines** (each applies only if a page shows a price; otherwise nothing is spent):
- DECISION D-1: a second Supabase project for production. Plan is $0 (second free project, or a second free org). If the dashboard shows a price, do not pay: free a slot or use a free org, or open `spend_approval`.
- DECISION D-2: GitHub private-repo features (environments, rulesets, Actions minutes) on the Free plan. If an Upgrade prompt appears: open `spend_approval`; options are a public repo, a paid plan, or a weaker pipeline (not recommended).
- DECISION D-3: Vercel team billing. If it shows a trial that will charge, or any Upgrade prompt, open `spend_approval`. Do not turn on Password Protection, Passport or Trusted IPs (paid).

**Order Matthew does them in:** 1 GitHub check, repo, push `main` and `staging` → 2 Supabase staging project (ca-central-1, sign-up off, keys, database address) → 3 Vercel project, Preview variables, Standard Protection, bypass secret → 4 Supabase URL configuration → 5 GitHub `staging` environment → 6 orchestrator `.env.local` (A2 verify) → 7 production (second Supabase project, release tokens, GitHub `production`, `main` protection) before the pipeline drills → 8 checklist, then approve the gate. About 60 to 90 minutes; parts 1 to 6 are what A2 needs.

## Amendment — 2026-11-19: drop Supabase access token (Nov 18 rule)
**Why:** Matthew's ruling (ledger decision 2026-11-19), from his Nov 18 rule: Supabase personal access tokens reach every org, so they never live on an agent machine. The orchestrator machine's `.env.local` now holds `SUPABASE_STAGING_DB_URL` only.
**Status:** done, except the secret-pattern grep (denied, below).
**File changed:** `docs/ops/account-setup.md` only. Nothing else in the packet was touched.

**Exact lines changed (all in `docs/ops/account-setup.md`; line numbers are after the edit):**
1. Part 6 intro (line 130), was: "These two names go in that machine's **`.env.local`** (already git-ignored). They do **not** go in Vercel, and they do not go in GitHub." Now: "This name goes in that machine's **`.env.local`** (already git-ignored). It does **not** go in Vercel, and it does not go in GitHub."
2. Part 6 table: the `SUPABASE_ACCESS_TOKEN` row (the `northside-quotes-verify` token, 30-day expiry, calendar reminder) is deleted. The `SUPABASE_STAGING_DB_URL` row is unchanged.
3. Part 6 step 1, was: "...add the two names, one per line, with the values pasted..." Now: "...add the name, with the value pasted from the other tab..." (rest of the sentence unchanged).
4. Part 6 step 3, was: "A Supabase access token reaches every organization on the account that creates it. Create it from the account that holds the sandbox org..." Now: "**No Supabase access token goes on this machine** (Matthew's Nov 18 rule: ...). A2 (migrations, RLS tests and type generation) needs no access token. It applies migrations and runs tests through `SUPABASE_STAGING_DB_URL`, or through the local Supabase stack. `supabase db push` is on the deny list and is not used, and neither is `supabase link`."
5. Part 7 table, `SUPABASE_ACCESS_TOKEN` row, was: "...Same name as on the machine in Part 6, but a different token". Now: "...Lives only in this GitHub environment, never on an agent machine". (The row stays: it is the production release token in GitHub `production`, see Notes.)
6. Part 8 checklist, orchestrator row, was: "`SUPABASE_STAGING_DB_URL` and `SUPABASE_ACCESS_TOKEN` in `.env.local`; reminder set". Now: "`SUPABASE_STAGING_DB_URL` in `.env.local` (no access token on this machine)".
7. Afterwards, was: "**Every 28 days:** new Vercel and Supabase tokens go into GitHub `production` and the machine's `.env.local`, then delete the old ones." Now: "**Every 28 days:** new Vercel and Supabase release tokens go into GitHub `production`, then delete the old ones. Nothing is renewed on the orchestrator machine, because it holds no token."

**Steps that relied on the token:** none other. The packet never used `supabase link` or remote type generation. Part 5's line "no access token goes into `staging`" is unchanged. Equivalents for A2, as now stated in Part 6 step 3: migrations and RLS tests through `SUPABASE_STAGING_DB_URL` or the local stack; type generation from the same database URL or the local stack (`supabase gen types --db-url` / `--local` do not need a token; I did not run them, so unverified here). Nothing needs Matthew's own machine.

**Commands run:**
- `grep -n 'SUPABASE_ACCESS_TOKEN' docs/ops/account-setup.md` → one hit, line 150 (the Part 7 production release token row).
- `grep -c 'SUPABASE_STAGING_DB_URL'` → 5 (was 4; the new Part 6 step 3 names it). `grep -c 'ca-central-1'` → 8. `grep -c '{{'` → 0.
- Secret-pattern grep (token, key and JWT prefixes) → **not run: the permission system denied it again**, in a compound command and on its own. I did not try another route. Unverified by me. By inspection, the diff adds only variable names, no values.

**Notes for the next step and for Matthew:**
- **Still names the token elsewhere (not mine, not changed):** `PLAN.md` line 47, `.baseleap/plan-blueprint.json` (OPS-SETUP acceptance line 42 and the A2 verify), and `.baseleap/gates/account_setup-1.md` line 8 still say the orchestrator machine needs `SUPABASE_ACCESS_TOKEN`. The orchestrator should update these, or the A2 verify and the open gate will still ask Matthew to set it. Kit templates in `.claude/skills/` (`ops-secrets`, `ops-environments/templates/account-setup.md` and `environments.json`, `ops-release/templates/release.yml`, `ops-observe/templates/runbook.md`) also carry the token; the kit owner may want the same rule there.
- **Question for Matthew:** the production release token (`SUPABASE_ACCESS_TOKEN` in GitHub `production`, used by `release.yml` for `supabase db push`) is also a personal access token that reaches every org on its account. I kept it because the instruction covered the agent machine and GitHub `production` is not one. If the Nov 18 rule also bars it from GitHub, the release workflow needs a different migration route (for example the production session-pooler URL as a `production` secret), which means a template change in a later pipeline step.
- Note 37 above (A2's verify needs `SUPABASE_ACCESS_TOKEN`) is superseded: A2 needs only `SUPABASE_STAGING_DB_URL`.

### Updated gate summary (paste into the `account_setup` packet, replaces the earlier one's orchestrator line)
Same as the summary above, with these changes:
- Orchestrator machine `.env.local`: `SUPABASE_STAGING_DB_URL` only (name only; not in Vercel, not in GitHub). **No Supabase access token on this machine** (Matthew's Nov 18 rule). A2 (migrations, RLS tests, type generation) uses the database URL or the local Supabase stack. `supabase db push` and `supabase link` are not used.
- Checklist row for the machine: `SUPABASE_STAGING_DB_URL` in `.env.local`; nothing else to set, no reminder.
- Order step 6 is now: orchestrator `.env.local` with the database address only (A2 verify).
- Part 7 is unchanged: the production release tokens still go only into GitHub `production`.

## Amendment 2 — 2026-11-19: A1 env names, GHL scopes, token A
**Why:** (1) A1 introduced four env var names that the packet lacked (docs/architecture.md "Environment variables", docs/integration-contract.md "Credentials and scopes", .baseleap/reports/A1.md). (2) The GHL scopes are now known. (3) Matthew's ruling "token A": no Supabase personal access token anywhere; production migrations use the production database connection string, stored only in the GitHub `production` environment. (4) Cron is daily on Vercel Hobby, 5 entries.
**Status:** done, except the secret-pattern grep (denied again, below).
**File changed:** `docs/ops/account-setup.md` only. Names only, no values and no example values.
**Read:** the packet, docs/architecture.md (env table, retry schedule), docs/integration-contract.md (Credentials and scopes, handoff), .baseleap/reports/A1.md and OPS-SETUP.md, the `release.yml` template (read only, to see what it uses). External, read-only: Vercel cron usage and pricing page (last updated 2026-07-15).

**Exact changes (all in `docs/ops/account-setup.md`):**
1. **Part 3 table:** four new rows. `APP_SIGNING_SECRET` and `CRON_SECRET` (Production and Preview, each a different value, **Sensitive**); `GHL_LOCATION_ID` (Production and Preview, same value, Config); `GHL_API_BASE_URL` (optional, "do not create", no type). Production values are added in Part 7, step 3, as for the other rows.
2. **Part 3, new explanatory block** (after the table), one bullet per name:
   - `APP_SIGNING_SECRET`: signs the public form token and keys the IP and email hashes. Lives in Vercel only (Preview now, Production in Part 7). Not in GitHub, not in the orchestrator `.env.local`, not on any agent machine. **Matthew generates it himself** (password manager generator, at least 32 random bytes); a different value for Production; saved in the password manager. Nobody on the dev team sees or sets it.
   - `CRON_SECRET`: protects `/api/jobs/*`. Vercel only, Sensitive, Preview now and Production in Part 7, each generated by Matthew, not on any agent machine. Vercel sends the Production value itself on scheduled calls. The Preview value is only for QA's manual staging trigger; where else that needs to live is a later setting request (see Notes).
   - `GHL_LOCATION_ID`: id of the GHL test sub-account, not a secret, Config row in both environments, copied by Matthew from the test sub-account.
   - `GHL_API_BASE_URL`: optional; Matthew sets nothing, no row; the app has a default and tests use a local stand-in.
3. **Part 3, GHL token paragraph:** the "per integration-contract.md" placeholder is replaced by the real scopes, exactly `contacts.readonly` and `contacts.write` and nothing else. It stays a later setting request through ops-secrets (nothing before the GHL integration step needs it; a missing token only makes the GHL copy report "failed", docs/integration-contract.md), and the paragraph says what that request will contain (name, two scopes, two Sensitive rows). The two table cells still say "later, not at this gate".
4. **Decision D-3, cron note:** the architect-facing sentence is replaced by the checked Hobby facts (once a day per entry, up to 59 minutes late, up to 100 entries per project) and the 5 entries (four `ghl-sync`, one `housekeeping`), with three setup consequences: nothing to configure in the dashboard (the entries live in `vercel.json`); entries run on Production only, so staging has no scheduled runs, and Production gets them after its first successful release deploy (not the failed import build); the Production `CRON_SECRET` must exist before that first release. A "Hobby accounts are limited to daily cron jobs" deploy error is a `vercel.json` fix, not a reason to pay.
5. **Part 7, step 2:** "Supabase release token" (name `northside-quotes-release`, 30-day expiry, calendar reminder) is replaced by "Production database address": Connect, Direct connection string, Session pooler, check host contains `ca-central-1`, replace the password placeholder in the box (never in a document), save to the password manager, store **only** in GitHub `production` as `SUPABASE_PRODUCTION_DB_URL`; never Vercel, `.env.local`, `staging` or any agent machine; rebuild it if the production DB password changes. States that no Supabase access token is created anywhere.
6. **Part 7, step 3:** "everything except the GHL row" is now "everything except `GHL_PRIVATE_INTEGRATION_TOKEN` (later) and `GHL_API_BASE_URL` (never set)", plus the note that Production `APP_SIGNING_SECRET` and `CRON_SECRET` are new values different from Preview.
7. **Part 7 GitHub `production` table:** the `SUPABASE_ACCESS_TOKEN` row is replaced by `SUPABASE_PRODUCTION_DB_URL` (secret). Count stays 3 secrets, 3 variables.
8. **Part 8 checklist:** the Vercel row lists the new Preview rows (and "no `GHL_API_BASE_URL`, no GHL token yet"); the "Before the drills" row says "Vercel release token, production database address (`SUPABASE_PRODUCTION_DB_URL`, no Supabase token), Vercel Production rows (with their own `APP_SIGNING_SECRET` and `CRON_SECRET`)" instead of "both release tokens".
9. **Afterwards:** the 28-day rotation now covers the Vercel release token only; Supabase has no token to renew and `SUPABASE_PRODUCTION_DB_URL` changes only with the production database password.
Nothing else was changed (item 8 and 9 are the two consequential wording fixes the token swap required, so the packet does not talk about a token that no longer exists).

**Commands run (from `/home/admin/baseleap/rehearsal/northside-quotes`):**
- `test -s docs/ops/account-setup.md` → exit 0.
- `grep -c '{{'` → 0 (no placeholders).
- `grep -c 'ca-central-1'` → 9 (was 8; the new Part 7 step 2 host check).
- `grep -c 'SUPABASE_STAGING_DB_URL'` → 5 (unchanged).
- `! grep -n SUPABASE_ACCESS_TOKEN docs/ops/account-setup.md` → exit 0, no output: the name no longer appears in the packet.
- `! grep -En 'eyJ…|sb_secret_…|pit-…|gh[pousr]_…|sk_(live|test)_' docs/ops/account-setup.md` (pattern from the plan blueprint, line 54) → **not run: the permission system denied it** (it was denied in the first attempt and Amendment 1 too, despite the brief saying it is allowed now). I did not try another route. **Unverified by me**; the ledger's run decides. By inspection of every line I added: names, placeholders (`[YOUR-PASSWORD]`, `<production ref>`), and the Vercel docs host; no values. `git status` shows only `docs/ops/account-setup.md` modified (plus the pre-existing untracked files).
- `git diff --stat` was also denied; not needed.
- Vercel cron limits: fetched https://vercel.com/docs/cron-jobs/usage-and-pricing (page last updated 2026-07-15): Hobby, once per day, ±59 min, 100 per project. Confirms the architect's reading.

**CONTRACT QUESTION:** none.
**BLOCKED:** none.

**Notes for the next step and for Matthew:**
- **Release template (later pipeline step, mine):** `.claude/skills/ops-release/templates/release.yml` still uses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` with `supabase db push --remote`. The real `release.yml` will instead apply migrations with the `SUPABASE_PRODUCTION_DB_URL` secret (`supabase db push --db-url`, dry run first; unverified here, to be tested in the pipeline drills), and refuse a staging host. `supabase db push` stays denied on agent machines; it only runs inside the approved workflow.
- **Question for Matthew (left unchanged because the instruction said change nothing else):** the `SUPABASE_DB_PASSWORD` secret (Part 7 table) and the `SUPABASE_PRODUCTION_REF` variable look redundant once the connection string carries the password. I kept both. If you agree, DevOps removes them from the packet and the checklist (then GitHub `production` has 2 secrets, 2 variables). One less place for the production database password to live.
- **Orchestrator, still naming the token (not mine):** `PLAN.md` line 47, `.baseleap/plan-blueprint.json` (OPS-SETUP acceptance and the A2 verify) and `.baseleap/gates/account_setup-1.md` line 8, plus the kit templates under `.claude/skills/` (`ops-secrets`, `ops-environments`, `ops-release`, `ops-observe`). Same as Amendment 1.
- **Staging cron trigger:** QA calls `/api/jobs/ghl-sync` on staging with `CRON_SECRET`. That needs the Preview value available to the QA run (GitHub `staging` environment secret), which is not in the packet and which only Matthew can set. DevOps will send a setting request when QA's test needs it. Until then, no `CRON_SECRET` in GitHub.
- **Unverified items I did not check:** the exact place of the Location ID in GHL's screens (the packet says "address bar after `/location/`, and in settings" and asks for a screenshot if different); that rotating `APP_SIGNING_SECRET` invalidates open form tokens (inference from its use, per docs/architecture.md); that `supabase db push --db-url` works against the session pooler.
- `infra/environments.json`, `.env.example` and `scripts/env-check.mjs` (my later pipeline step) must declare: `APP_SIGNING_SECRET`, `CRON_SECRET` (Vercel, Sensitive, Preview and Production), `GHL_LOCATION_ID` (Vercel, Config, Preview and Production), `GHL_API_BASE_URL` (optional, absent from Vercel), `SUPABASE_PRODUCTION_DB_URL` (GitHub `production` secret).

### Gate summary after Amendment 2 (paste into the `account_setup` packet; replaces the earlier summaries where they differ)
Same as the first summary and Amendment 1's update, with these changes:
- **Four new Vercel variable names, set by Matthew only:** `APP_SIGNING_SECRET` and `CRON_SECRET` (Sensitive; Preview now, Production in Part 7; each a random value Matthew generates himself, a different one per environment; never in GitHub, never on an agent machine); `GHL_LOCATION_ID` (Config; the GHL test sub-account's id, Preview now and Production in Part 7); `GHL_API_BASE_URL` (optional; nothing to set). About 10 more minutes in Part 3 and Part 7.
- **GHL token** `GHL_PRIVATE_INTEGRATION_TOKEN`: scopes are exactly `contacts.readonly` and `contacts.write`. Still a later setting request (not at this gate); nothing to create now.
- **No Supabase personal access token anywhere** (token A). Part 7 step 2 is now the production database address (session pooler URI, host in ca-central-1), stored only in GitHub `production` as `SUPABASE_PRODUCTION_DB_URL`. GitHub `production` still holds 3 secrets (`VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`, `SUPABASE_DB_PASSWORD`) and 3 variables.- **Cron:** $0 on Hobby. 5 daily entries (four GHL retries, one housekeeping), up to 59 minutes late; run on Production only; declared by DevOps in `vercel.json`, nothing to click. The Production `CRON_SECRET` must exist before the first release.
- Spend decisions unchanged: D-1, D-2, D-3 apply only if a page shows a price; nothing in this amendment costs money.

## Amendment 3 — 2026-11-25: signing and cron secrets per environment, production part matched to OPS1, public repo, Fluid Compute
**Why:** Matthew reopened the step (ledger decision 2026-11-23) for a final amendment before the SOPs and the production release use the packet.
**Status:** done, except the secret-pattern grep (not run, see Commands run).
**File changed:** `docs/ops/account-setup.md` only. Names only; no values.
**Read:** the packet, `.github/workflows/release.yml`, `infra/environments.json`, `.env.example` (grep for two names only), `.baseleap/plan-blueprint.json` (OPS-SETUP verify list), `.baseleap/reports/INT1.md` (the `maxDuration` line), and the `ghl-sync` route in the backend worktree (`src/app/api/jobs/ghl-sync/route.ts`, line 17: `export const maxDuration = 300;`). External, read-only: Vercel docs (fluid compute, function duration; both last updated 2026-08-24) and GitHub's plans page.

**Exact changes (all in `docs/ops/account-setup.md`):**
1. **Part 3, new block "The two secrets you generate: one row per environment"** (before "Tick Production and Preview"): a table of four rows, `APP_SIGNING_SECRET` Preview, `APP_SIGNING_SECRET` Production, `CRON_SECRET` Preview, `CRON_SECRET` Production. Each says Vercel, **Sensitive**, at least 32 random characters, generated by Matthew, different per environment. Bullets under it: Vercel only (never GitHub, never an agent machine, including the orchestrator `.env.local`); four distinct values; generated on Matthew's own computer, for example `openssl rand -hex 32` (or the password manager's generator); **warning: no trailing whitespace or newline when pasting** (a trailing space in `CRON_SECRET` broke the Preview build with `INVALID_CRON_SECRET`, as reported from staging); after changing a value Matthew must create a new deployment (Preview: ask DevOps to redeploy `staging` or push a commit; Production: only by the next release, not the Redeploy button).
2. **Part 3, `APP_SIGNING_SECRET` bullet:** "the password manager's generator, at least 32 random bytes; a 64-character random string is enough" became "at least 32 random characters, see the rules table below; `openssl rand -hex 32` gives 64". Reason: the old text said bytes, the new rule says characters; two minimums in one document would conflict.
3. **Part 7, step 3 (Vercel production rows):** the sentence "add the Production column..." is now an explicit table: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (production Supabase values), `SITE_URL`, `APP_SIGNING_SECRET`, `CRON_SECRET`, `GHL_LOCATION_ID`, and `GHL_PRIVATE_INTEGRATION_TOKEN` marked "still to come, not at this gate". `GHL_API_BASE_URL` stays "never set". It says `SUPABASE_PRODUCTION_DB_URL` is not a Vercel variable.
4. **Part 7, GitHub `production` table:** removed the `SUPABASE_DB_PASSWORD` secret and the `SUPABASE_PRODUCTION_REF` variable. What remains matches `release.yml` and `infra/environments.json` (`github.production`): secrets `VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`; variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Added a sentence saying so and that there is no Supabase access token (token A). `release.yml` reads exactly those four, plus the repo variable `PRODUCTION_URL`.
5. **Part 7, step 6:** `PRODUCTION_URL` is said to be a repository-level variable (not inside an environment), read by `release.yml` and the uptime check.
6. **Public repo (Matthew's choice):** Summary table row, Accounts table row and Part 1 step 2 now say public; Part 8 checklist says public. **D-2** was rewritten: it is now "GitHub Free features on the public repo". It cites GitHub's plans page (read today): deployment protection rules are listed for public repositories on Free, and Actions on standard hosted runners is free in public repos, so the old 2,000-minute private allowance line is gone. **Unverified:** the page does not mention branch rulesets for Free, so Part 1 step 4 still has Matthew check the Rulesets page, and D-2 keeps the stop-on-price rule. The "make the repo public" and "keep it private with a weaker pipeline" options are removed (decided). Added: the repo is public, so no value of any kind ever goes into it.
7. **Part 7, new step 8 (Fluid Compute):** Matthew confirms Fluid Compute is on: Vercel dashboard, team `baseleap`, project `northside-quotes`, **Settings → Functions**, the **Fluid Compute** section (switch on; Save; applies to the next deployment). Sourced from Vercel's docs: Fluid Compute is on by default for new projects since April 23, 2025, and Hobby's maximum duration is 300 s with it. Marked **unverified for this project** (no Vercel login here). Tells Matthew not to touch Default Max Duration and to open `spend_approval` if a price shows.
8. **Part 8 checklist, "Before the drills" row:** now lists the production Vercel rows by name, the no-trailing-whitespace reminder, Fluid Compute (unverified), and GitHub `production` as 2 secrets and 2 variables (was 3 and 3).
Nothing else was changed.

**Correction to the brief (for Matthew):** `release.yml` does not contain `maxDuration`. It is set in the `ghl-sync` route file (`export const maxDuration = 300;`, in the backend worktree, not yet in the main tree; INT1.md line 74 says the route needs it). The packet says so. `vercel.json` has no `maxDuration` either (the house rule is per route file, ops-platform §2). The Fluid Compute step stands either way, because the 300 s route setting needs it on Hobby.

**Commands run (from `/home/admin/baseleap/rehearsal/northside-quotes`):**
- `test -s docs/ops/account-setup.md` → exit 0.
- `! grep -n '{{' docs/ops/account-setup.md` → exit 0, no output.
- `grep -q 'ca-central-1' docs/ops/account-setup.md` → exit 0.
- `grep -q 'SUPABASE_STAGING_DB_URL' docs/ops/account-setup.md` → exit 0.
- `! grep -n SUPABASE_ACCESS_TOKEN docs/ops/account-setup.md` → exit 0, no output.
- `! grep -En 'eyJ[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9]|pit-[0-9a-f]{8}|gh[pousr]_[A-Za-z0-9]{20,}|sk_(live|test)_' docs/ops/account-setup.md` → **not run: the permission system asked for approval, which nobody can give in this session.** Same as the earlier attempts. I did not try another route. **Unverified by me**; the ledger's run decides. By inspection, every added line holds names, placeholders and doc URLs; no values.
- `grep -n -i "private\|SUPABASE_DB_PASSWORD\|SUPABASE_PRODUCTION_REF"` → remaining hits are only the private photo bucket, the `GHL_PRIVATE_INTEGRATION_TOKEN` name, GHL's "Private Integration", and one sentence saying the two dropped names are not used.

**CONTRACT QUESTION:** none.
**BLOCKED:** none.

**Notes for Matthew and the next step:**
- Any Preview or Production `CRON_SECRET` or `APP_SIGNING_SECRET` row that already has a trailing space or newline must be re-entered, then redeployed.
- Anything Matthew already created in GitHub `production` from the old Part 7 table (`SUPABASE_DB_PASSWORD`, `SUPABASE_PRODUCTION_REF`) is now unused and can be deleted; `release.yml` ignores it. `env-check` does not read GitHub, so it will not flag it.
- Fluid Compute and GitHub rulesets on a public Free repo are both unverified until Matthew looks at the dashboard pages.
