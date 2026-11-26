# Set up production (account packet Part 7)

**For Matthew.** About 45–60 minutes, one sitting. **Unblocks:** DEP1, the first production release and its drills (release, rollback, secret rotation). Nothing reaches production until you also approve the release in GitHub (task T-approve-release).

**Why:** production needs its own database and its own secrets, which only you create. The full click-by-click text is `docs/ops/account-setup.md`, Part 7 (steps 1–8) and the Part 3 secrets table. This list is the order and the checks.

## Steps
1. **Supabase → New project** `Northside production`, region **Canada (Central), ca-central-1**, sign-up **off**, no Storage bucket by hand. In **Authentication → URL Configuration**: Site URL `https://northside-quotes.vercel.app`, redirect `https://northside-quotes.vercel.app/**`. You should see the project dashboard with region ca-central-1.
2. **Production database address:** in that project, **Connect → Direct · Connection string → Session pooler**. Copy the URI, replace `[YOUR-PASSWORD]` with the production DB password in the box you paste into. Check the host contains `ca-central-1`. Save it in your password manager.
3. **GitHub → repo `northside-quotes` → Settings → Environments → `production`** (create it if missing): deployment branch `main` only; untick *Allow administrators to bypass*; Required reviewers: `westmatty92-alt`. Add secrets `SUPABASE_PRODUCTION_DB_URL` (from step 2) and `VERCEL_TOKEN` (Part 3, step 7); variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. If `SUPABASE_DB_PASSWORD` or `SUPABASE_PRODUCTION_REF` exist there, delete them (no longer used).
4. **GitHub → Settings → Secrets and variables → Actions → Variables (repository):** `PRODUCTION_URL` = `https://northside-quotes.vercel.app`.
5. **Vercel → team `baseleap` → project `northside-quotes` → Settings → Environment Variables**, tick **Production only**, add: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all from the production project), `SITE_URL` = `https://northside-quotes.vercel.app`, `APP_SIGNING_SECRET` and `CRON_SECRET`.
   - Generate each secret fresh with `openssl rand -hex 32 | tr -d '\n'; echo`, different from Preview. **No trailing space or newline when pasting** (a trailing space broke staging with `INVALID_CRON_SECRET`). Mark both **Sensitive**.
   - `GHL_LOCATION_ID` and the GHL token: leave for later (see the Gate 3 packet). GHL copies will show "failed" until set; nothing else is affected.
6. **Vercel → Settings → Functions → Fluid Compute:** the switch should be **on**. If off, turn it on and **Save**. If it shows a price, stop and tell me (spend_approval).
7. Tell Claude: "Part 7 done". `main` protection (Part 7 step 7) comes after the first checks run; DevOps tells you when.

## Done check
DevOps runs `node scripts/env-check.mjs --manifest-only` (names only) and, in DEP1, the release workflow's own pre-flight checks the production database address names the production project in ca-central-1.

## If something looks different
- **Supabase asks for a paid plan for a second project:** stop; don't pay. Tell me (decision D-1 in the packet: free a slot or a second free org).
- **GitHub shows no "Environments" or reviewers need an upgrade:** the repo is public, so they should be free; if not, stop and tell me (D-2).
- **Vercel won't let you choose "Production only":** you're on the wrong project; check the top-left says `northside-quotes`.
