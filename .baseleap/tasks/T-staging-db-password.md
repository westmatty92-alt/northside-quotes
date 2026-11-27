# Fix the staging database password in both places (this machine and GitHub `staging`)

**For Matthew.** About 10 minutes, then a 10-minute wait. **Unblocks:** CI `api-tests` and every staging-backed test.

**Why:** the Session pooler address is right (pooler host, ca-central-1, port 5432, password present), but the pooler rejects the password: "password authentication failed for user postgres". Repeated failures trip Supabase's circuit breaker ("too many authentication failures, new connections are temporarily blocked"), which then blocks even the right password for a while. That's what made the 01:37 and later runs fail. So: one clean value, set in both places, then one test.

## Steps
1. **Supabase → project `Northside staging` (ckhkiarvfrfiwkvspduu) → Project Settings → Database → Database password → Reset database password.** Use **Generate a password** and make sure it has **only letters and digits** (no `@ : / ? # % &`). Special characters must be percent-encoded inside a URL; letters/digits avoid that trap. Copy it into your password manager as `Northside (TEST) · Supabase staging · Database password`.
2. **Supabase → Connect (top of the project) → Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` (brackets included) with the new password **in the box you paste into**. Check: host contains `pooler.supabase.com`, port `5432`, no space or newline at the end.
3. **This machine:** `cd /home/admin/baseleap/rehearsal/northside-quotes && node scripts/set-env.mjs SUPABASE_STAGING_DB_URL` and paste the URI when asked.
4. **GitHub → repo → Settings → Environments → `staging` → `SUPABASE_STAGING_DB_URL` → Update** → paste the same URI → **Update secret**.
5. **Wait 10 minutes** without running anything against the database (the breaker clears on its own), then tell Claude "staging DB password fixed".

## Done check
I run one read-only probe: `npm run db:check` must print the read-only checks without `password authentication failed` or `ECIRCUITBREAKER`. Only then do I run the api-tests suite locally and push once.

## If something looks different
- **Still "password authentication failed":** the URI was built with a different password than the one you just reset. Repeat steps 2–4 from the password manager entry; don't try several variants in a row (each failure feeds the breaker).
- **`ECIRCUITBREAKER` again:** something kept retrying. Wait 15 minutes and tell me; I'll check nothing else is connecting (CI re-runs, local tests).
- **set-env.mjs not found:** tell me; don't paste the value into chat.
