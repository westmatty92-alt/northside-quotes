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
