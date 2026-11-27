# Rehearsal clean-up list (Northside Plumbing (TEST))

Do after DEP1's drills are logged and the run is closed. Each item: who, and how to tell it's done.

1. **Delete the Supabase project `Northside production`** (ref epwbzhezitsknqtuykgv, main Pro org). Matthew, per spend_approval note "A; delete the production project after the rehearsal" (2026-11-26). Supabase → project → Settings → General → Delete project. Done when it no longer appears in the org and Billing shows no charge for it next cycle.
2. Then remove the now-dangling production settings: GitHub `production` secrets/variables (`SUPABASE_PRODUCTION_DB_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) and the Vercel Production-only variables, or archive the Vercel project. Matthew.
3. Revoke the Vercel release token (30-day expiry anyway). Matthew.
4. Staging test data: QA-E2E / QA-PROBE tagged requests on the staging project (lists in docs/qa-reports/). Delete with the staging project if the whole rehearsal is torn down.
5. Lane worktrees on this machine: `../northside-quotes-wt-backend`, `../northside-quotes-wt-frontend`, `../northside-quotes-wt-staging`. Orchestrator/Matthew after close.
6. `.baseleap/tools/` (venv, scanners, fuzz HAR reports holding the staging bypass header and a staff token; SEC-25 residual). Delete after close.
