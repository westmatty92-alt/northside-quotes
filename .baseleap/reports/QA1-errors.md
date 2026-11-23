# QA1 tickets (Critical first)

One root cause blocks the whole run. Evidence below is trimmed; no secret, token or personal data appears.

### BUG-QA1-1 · Staging preview cannot serve the Request page or sign anyone in: `GET /` is 500 and the form-token and sign-in routes answer 503 (consistent with `APP_SIGNING_SECRET` missing or short in the Preview environment)

| | |
|---|---|
| **Severity** | Critical (smoke tests failing; the done spine cannot start: no homeowner can submit, no staff member can sign in; 117 of 124 tests could not run) |
| **AC / tests** | AC-001.1 and AC-004.1 fail directly; everything behind them is blocked. Failing specs: `tests/e2e/auth.setup.ts › sign in as owner and save the session` and `… as helper …` · `tests/e2e/platform.both.spec.ts › SEC-2 two GETs of / carry different form-token nonces and Cache-Control no-store` · `tests/e2e/platform.both.spec.ts › the form-token routes are available: a made-up token is 401 form_token_invalid, not 503` |
| **Class hint → likely owner** | `env` → bl-devops (Matthew sets the Vercel Preview values) |
| **Why that owner** | The route handlers answer exactly as `docs/SECURITY_MODEL.md` invariant 15 describes for an unset or short `APP_SIGNING_SECRET`: `GET /` fails, the two `formToken` routes and `POST /api/auth/sign-in` answer 503 (`sign_in_unavailable` fail-closed is the designed behaviour, so the backend code is behaving). `/api/health` is 200 and reports commit `6ae29eb`, so the deployment itself is the right one. QA cannot read Vercel's variables, so **which variable is missing is unverified**: `APP_SIGNING_SECRET` fits all three symptoms; a missing or wrong Supabase variable could also break sign-in and `GET /`, but a made-up form token would then still be answered 401 before the database is touched, and it is not |
| **Signature suggestion** | `env: staging Preview environment lacks a valid APP_SIGNING_SECRET (>= 32 chars) → GET / 500, POST /api/quote-requests and POST /api/auth/sign-in 503` |
| **Target** | https://northside-quotes-git-staging-baseleap.vercel.app @ `6ae29eb` (from `/api/health`) |

**Steps to reproduce** (no sign-in or tenant needed)
1. `curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" "$STAGING_URL/"`
2. `curl -s -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" -H "X-Form-Token: v1.1700000000000.00000000-0000-4000-8000-000000000000.invalidsignature" -H "Content-Type: application/json" -d '{"name":"QA-E2E token probe","phone":"9055550142","email":"qa-e2e@example.com","address":"1 Test St, Hamilton ON","problem":"This is a token probe only.","urgency":"flexible","marketing_consent":false,"website":""}' "$STAGING_URL/api/quote-requests"`
3. Open `$STAGING_URL/sign-in`, enter the QA owner email and password (`QA_OWNER_EMAIL`, `QA_OWNER_PASSWORD`), press Sign in. Same with the helper.

**Expected** — step 1: 200 with a form token in the page (`docs/SECURITY_MODEL.md` "One token per page load"); step 2: 401 `form_token_invalid` (`docs/openapi.yaml` `createQuoteRequest`; the token is checked before anything is stored, so nothing is created); step 3: sign-in succeeds and lands on `/requests` (AC-004.1).
**Actual** — step 1: `500` (Next.js error page); step 2: `503` `{"type":"about:blank","title":"We couldn't send your request. Please try again.","status":503,"code":"service_unavailable"}`; step 3: `503` on `POST /api/auth/sign-in`, the page stays on `/sign-in`.

**Evidence**
- Traces: `test-results/auth.setup.ts-sign-in-as-owner-and-save-the-session-setup/trace.zip` · `test-results/platform.both-preview-plat-14552--form-token-invalid-not-503-preview/trace.zip` · `test-results/platform.both-preview-plat-40718--and-Cache-Control-no-store-preview/trace.zip` (all kept on failure; they contain the bypass header, so they must not be committed or shared)
- Request ids (Vercel `x-vercel-id`): `GET /` → `yul1::yul1::fk5tx-1795472820349-4e071fe2e455` (500) · `POST /api/quote-requests` → `yul1::yul1::h2sml-1795473972424-d4c7f926c3da` (503) · `POST /api/auth/sign-in` → `yul1::yul1::dhb22-1795473947215-e562143f8e3f` (503)
- Both failing platform tests failed the same way on the retry (not flaky). Console: `Failed to load resource: the server responded with a status of 503`.
- Raw results: `docs/qa-reports/playwright-results.json`

**What would prove the fix** — after a redeploy of `staging`: `npx playwright test tests/e2e/platform tests/e2e/auth.setup.ts` passes (the two platform checks and both sign-ins). Then reopen QA1 for the full run; the spine and the other specs have not yet met the running app.
