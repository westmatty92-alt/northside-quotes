## 🛑 escalation: wave 1 half-blocked (lanes unreachable; two staging env names missing)
**Asking:** Two setup fixes, then resolve this escalation.
**Recommendation:** Grant the two lane folders to agent sessions (kit), and re-check `.env.local` for the two names below.

1. **Lanes are outside the session's allowed folder.** BE1 and FE1 were refused every read/write in `../northside-quotes-wt-backend` and `../northside-quotes-wt-frontend` ("outside allowed working directories"). The ledger expects lanes as sibling folders, so the kit needs `permissions.additionalDirectories` for `../northside-quotes-wt-backend` and `../northside-quotes-wt-frontend` (or a `*-wt-*` sibling rule), plus git commands run inside a lane without the "cd before git" approval prompt. Fallback (not recommended): run backend and frontend one after the other in the main tree, losing the parallel lanes.
2. **`.env.local` seems to lack `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.** INT1's staging tests need both (the runner uses the REST admin client; the DB URL can't stand in). The integration engineer reports the names it found are `BASELEAP_*`, `QA_*` and `SUPABASE_STAGING_DB_URL` only. I did not open the file (deny rule), so please check by name: if they went into another file (e.g. `.env`) or under other names (`SUPABASE_STAGING_URL`, `SUPABASE_STAGING_SERVICE_ROLE_KEY`), tell me which and the helper maps them. Optional: `SUPABASE_STAGING_REF` and `SUPABASE_PROD_PROJECT_REF` turn on the never-production guard. (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `STAGING_URL` were not reported either: please check all of them)

Done so far, no work lost:
- Lanes created from staging at 529b168 and pushed (`lane/backend`, `lane/frontend`); `staging` has the locked blueprint
- OPS1 verified 9/9 (vercel.json, env-check self-test 24/24, actionlint with checksum-verified install, 4 workflows SHA-pinned, release via the production DB string, runbook; no access token anywhere)
- INT1 built (client, match rule, stage tags, lease-safe runner, 11-mode simulator; 86 offline tests pass). Its 12 staging tests used to skip silently: now they fail by name until fix 2. Re-verified after fix 2
- Not recorded as failures (environment)

**If yes:** I re-verify INT1, then run BE1 and FE1 in their lanes, and carry on wave by wave to Gate 3.
**If no:** tell me to take the fallback for 1.
