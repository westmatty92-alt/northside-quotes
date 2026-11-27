## 🛑 escalation: staging preview can't serve the form or sign anyone in (Vercel Preview settings)
**Asking:** Check/set the Vercel Preview variables below, redeploy `staging`, then resolve.
**Recommendation:** Set `APP_SIGNING_SECRET` (32+ random characters) for Preview first; it is the likely cause. Check the rest while you're there.

What QA1 saw on https://northside-quotes-git-staging-baseleap.vercel.app (health OK, version 6ae29eb):
- `GET /` → 500; form-token POST → 503 (contract says 401 for a bad token); sign-in → 503 for owner and helper
- That is exactly the fail-closed behaviour of SECURITY_MODEL invariant 15 when `APP_SIGNING_SECRET` is missing or shorter than 32 characters. I can't read Vercel's settings, so which variable it is is **unverified**
- Request ids for Vercel logs: `yul1::yul1::fk5tx-1795472820349-4e071fe2e455` (/), `yul1::yul1::dhb22-1795473947215-e562143f8e3f` (sign-in)

Vercel → northside-quotes → Settings → Environment Variables → **Preview** must have (names only):
- `APP_SIGNING_SECRET`: 32+ random characters, different from production
- `CRON_SECRET`: 32+ random characters, different from production
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: the **staging** project's
- `SITE_URL`: the staging address
- `GHL_LOCATION_ID` and the GHL token: still later (GHL copies end as "failed: config missing" on staging until then, by design)

Then **Redeploy** the latest `staging` deployment (variable changes don't reach an existing build).

Progress:
- INT2 verified (82 route tests; cron route fails closed; unticked retry → 409 with no GHL call); merged; `staging` = 6ae29eb; run is in the verify phase
- QA1: test plan (every AC mapped; live GHL marked unverified) and a 124-test Playwright suite on the preview, protected by a staging-host-only guard; 3 pass, 4 fail on this one root cause, 117 not yet run. Recorded as QA1 attempt 1/3, class env
- Note: the suite paces itself to the 5-per-10-minutes form limit, so a full run takes ~25–30 minutes

**If yes:** I re-run QA1 (attempt 2), route any product bugs to their owners, then QA2 + visual review, code review, security, SOPs, and stop at Gate 3.
