# QA2 tickets: permission probes and API boundaries on the staging preview

## Re-run at `bb54c17` (2026-11-24): all three tickets RESOLVED, no open ticket, no new ticket

Run `ida17`: `npx playwright test tests/e2e/probes` → 54 passed, 0 failed, 0 flaky (`docs/qa-reports/QA2-run.md`). Each regression test now passes and stays in the suite.

| Ticket | Status | Regression test that now passes |
|---|---|---|
| BUG-QA2-1 | RESOLVED | `PRB-06` (102 requests, 9 pages) and `PRB-06b` (27 requests): every unknown path answers 404 for every method and header |
| BUG-QA2-2 | RESOLVED | `PRB-74b`, tightened to require 422 `problem+json` naming `name`, `problem` or `address` for an unpaired surrogate (create and update paths) |
| BUG-QA2-3 | RESOLVED under the 400 ruling | `PRB-08`: `text/plain` and form-encoded bodies answer 400 `bad_request`, never a 401 sign-in failure. Open soft question for the architect (no 415 in the contract); if the contract gains one, change the expected status in `PRB-08` |

The original tickets follow unchanged, for the record.

---

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app · **Commit:** `42208a49aaaf21477fd369360f6a17caed80254f` · **Run:** `npx playwright test tests/e2e/probes`, run id `gqutp`, evidence `docs/qa-reports/playwright-results.json`, report `docs/qa-reports/QA2-run.md`.

**No Critical ticket: no permission boundary was crossed.** Three root causes, each with a failing regression test that stays in the suite (the ledger's probes command stays red until they are fixed, by design). `$STAGING_URL` is the preview above and `$BYPASS` is `VERCEL_AUTOMATION_BYPASS_SECRET` (sent as `x-vercel-protection-bypass` to the preview host only).

Order: Important first, then Minor.

---

## BUG-QA2-1: Unknown paths answer `200` with the app's HTML page instead of `404`

- **Severity:** Important
- **AC / contract:** AC-004.10 ("a direct request to change or reset [a password] is refused"); `docs/SECURITY_MODEL.md` permission matrix, "Any password change or reset route ... does not exist (404)"; `docs/openapi.yaml` (errors are `problem+json`, a missing resource is 404).
- **Failing tests:** `tests/e2e/probes/10-anonymous-routes.probe.spec.ts` › `PRB-06` (85 cases) and `PRB-06b` (15 cases).
- **Class hint and likely owner:** `server`. `x-matched-path` is `/_not-found` on every bad answer, so the app's not-found handler runs but the status is 200. bl-backend first (the `/api/*` side; a catch-all route handler returning the contract's 404 `problem+json` for every method would fix it), bl-frontend if the not-found page or `src/proxy.ts` belongs to them. Nothing here points at the database.
- **Signature suggestion:** `unknown-path-returns-200-not-found-shell`

**Steps to reproduce** (no tenant needed, anonymous):
1. `curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $BYPASS" "$STAGING_URL/api/password"` gives **404** (correct).
2. The same URL with any `Authorization` header: `curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $BYPASS" -H 'Authorization: Bearer x' "$STAGING_URL/api/password"` gives **200**, `content-type: text/html`.
3. `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "x-vercel-protection-bypass: $BYPASS" -H 'content-type: application/json' -d '{"a":1}' "$STAGING_URL/api/password"` gives **200**, `text/html`. Same for PUT and DELETE, and for any other unknown path (`/api/auth/does-not-exist`, `/does-not-exist`, `/api/reset-password`, `/api/auth/forgot-password`, `/api/inbox`, ...).

**Expected:** 404 for every method and every header combination (for `/api/*`, `application/problem+json` with code `not_found`). **Actual** (from `PRB-06b`, 3 paths x 9 variants): GET plain, GET with `Accept: application/json`, GET with a `Cookie`, and HEAD answer 404; **GET with an `Authorization` header, POST (with and without a body), PUT and DELETE answer 200 with HTML**, on `/api/does-not-exist`, `/api/auth/does-not-exist` and `/does-not-exist` alike. In `PRB-06`, 17 password, reset, recover, sign-up and magic-link style API paths x (GET with a staff token, POST and PUT with and without a session) = 85 cases, all 200 HTML; the pages `/forgot-password`, `/reset-password`, `/change-password`, `/sign-up`, `/signup`, `/register`, `/auth/reset`, `/account/password` and `/inbox` answer 404 when requested plainly.

**Why it matters:** no password feature exists and nothing was sent, so this crosses no boundary. But the answer to "does a password-reset route exist?" is "200, yes" to any scanner or client reading the status, which is what AC-004.10 and the security model say must not be the case; an API client that posts to a wrong URL is told it succeeded; and a monitoring check on status codes sees a healthy page.

**Evidence** (request ids for the backend's log lines, full run `gqutp`):
- `GET /api/password` with the staff bearer: 200, `yul1::yul1::5f97c-1795571246884-f018cfc8a075`
- `POST /api/password`, no session: 200, `yul1::yul1::9b4gx-1795571246948-93d764cdffec`
- `GET /api/does-not-exist` with `Authorization: Bearer x`: 200, `yul1::yul1::lgzpw-1795571256345-5a7b6bb34589`
- `POST /api/does-not-exist`: 200, `yul1::yul1::8jp4t-1795571256699-2f3cea99a01a`
- `DELETE /api/does-not-exist`: 200, `yul1::yul1::xpn46-1795571256995-d86e0c1339a7`
- Attachment `status-table` and `failing-cases` on the two tests in `playwright-report/`; trace in `test-results/` (git-ignored).

---

## BUG-QA2-2: `POST /api/quote-requests` returns 500 when `name`, `problem` or `address` contains an unpaired UTF-16 surrogate

- **Severity:** Important (a public, unauthenticated route answers 500 to text a client can send; the body is the generic `internal_error` and holds no database text, nothing is stored).
- **AC / contract:** `docs/openapi.yaml` `createQuoteRequest`: invalid input is 422 with the field named, a 500 is only for an unexpected failure; the qa-fuzz rule "never 500". SECURITY_MODEL invariant 11 (errors are caught and logged as class only) is respected, which is why the body is clean, but the input should never have reached the database.
- **Failing test:** `tests/e2e/probes/80-storage-and-create.probe.spec.ts` › `PRB-74b` (4 cases, all 500).
- **Class hint and likely owner:** `server`, bl-backend. The staff note and the search text with the same characters are handled (`PRB-44` passes), and a NUL character is handled (`PRB-74b` passes those cases), so validation exists for those but not for surrogates on the public create path. Likely cause (unverified, QA does not read code): Postgres (jsonb or text) cannot store a lone surrogate, so the database call fails after the zod check passed. Suggested fix: reject strings that are not well-formed Unicode in the zod schema (for example `String.prototype.isWellFormed()`) and answer 422 naming the field, for every text field of `QuoteRequestCreate`.
- **Signature suggestion:** `create-route-500-on-unpaired-surrogate`

**Steps to reproduce** (anonymous; the form token must be at least 3 seconds old, and a request that works takes one of the 5 submission slots, but this one does not):
1. `GET $STAGING_URL/` with the bypass header and read the form token from the page (`v1.<ms>.<uuid>.<signature>`); wait 4 seconds.
2. `curl -s -X POST "$STAGING_URL/api/quote-requests" -H "x-vercel-protection-bypass: $BYPASS" -H "X-Form-Token: $TOKEN" -H 'content-type: application/json' --data-binary '{"name":"Zo\ud800e Probe","phone":"905-555-0142","email":"dana@example.com","address":"14 Barton St W, Hamilton ON","problem":"Kitchen tap drips constantly and the cabinet is wet","urgency":"soon","website":""}'` (the `\ud800` is the six characters backslash-u-d-8-0-0 inside the JSON text).
3. Repeat with `"problem":"The tap drips \udc00 and the cabinet is wet"` and with `"address":"12 Main St \ud83d, Hamilton"`.

**Expected:** 422 `validation_failed` with `errors[]` naming `name` (or `problem`, `address`). **Actual:** 500, `application/problem+json`, `{"type":"about:blank","title":"Something went wrong","status":500,"code":"internal_error"}`, for all three fields, on a new request and on an update of a pending one (same token, changed answers).

**Evidence:**
- create path, `name`: `yul1::yul1::cq5jd-1795572365927-963bf3bc1942`
- create path, `problem`: `yul1::yul1::vrnzs-1795572366005-3ef28418ab45`
- create path, `address`: `yul1::yul1::vrnzs-1795572366103-1dea43f163e3`
- update path, `name`: `yul1::yul1::b2558-1795572364404-0cf09d731e7c`
- first sighting in a development run: `yul1::yul1::xpn46-1795571102114-67d61e271d75`
- `failing-cases` attachment on `PRB-74b` in `playwright-report/`.

**Regression test** `PRB-74b` also covers: NUL in name and problem, SQL-looking and filter-looking text, `null` for `website`, `photos` and `marketing_consent`, 501-character `website`, a 1.5 MB padding field, and four malformed bodies. All of those pass today.

---

## BUG-QA2-3: `POST /api/auth/sign-in` accepts `Content-Type: text/plain` and treats the body as JSON

- **Severity:** Minor (a hardening gap; bl-security can re-rate it). No AC fails: the lockout trade-off (ruling 4A) is accepted. It adds one way to trigger it.
- **AC / contract:** `docs/openapi.yaml` `signIn` documents `application/json` only; `BadRequest` is "Malformed request"; qa-fuzz rule "wrong content type gives the documented code". `docs/threat-model.md` (the `POST /quote-requests` row about a cross-site request burning a victim's address quota) relies on the custom `X-Form-Token` header forcing a CORS preflight; the sign-in route has no custom header, so only the JSON content type could force one, and the route does not insist on it.
- **Failing test:** `tests/e2e/probes/10-anonymous-routes.probe.spec.ts` › `PRB-08`, case `text/plain content type` (the other four malformed bodies pass).
- **Class hint and likely owner:** `server`, bl-backend (read the body only when `Content-Type` is `application/json`, otherwise 415 or 400).
- **Signature suggestion:** `sign-in-accepts-text-plain-json-body`

**Steps to reproduce:** `curl -s -X POST "$STAGING_URL/api/auth/sign-in" -H "x-vercel-protection-bypass: $BYPASS" -H 'content-type: text/plain' --data-binary '{"email":"qa-probe-nobody@example.test","password":"x"}'`

**Expected:** 400 (or 415 or 422) `problem+json`. **Actual:** `401 {"type":"about:blank","title":"Email or password is incorrect","status":401,"code":"invalid_credentials"}`: the body was parsed as JSON and the attempt was counted as a failed sign-in.

**Why it matters:** a page on any other site can make the visitor's browser send `text/plain` POSTs to this route without a CORS preflight (a "simple request"; there is no CORS, but the request is still sent and processed, only the answer is unreadable). Twenty of them from a staff member's browser count 20 failures against the staff member's own network address and pause sign-in from that address for 15 minutes (SECURITY_MODEL, per-address limit). With `application/json` the browser would have to preflight and be refused.

**Evidence:** `yul1::yul1::b2558-1795571265566-e397451956d6` (full run), `yul1::yul1::f4hgc-1795569841814-1b38f84d6c7d` (first sighting).

---

## Not tickets (recorded so nobody reads them as findings)

- **Vercel's edge refuses a few hostile requests before the app runs** with a plain-text 403 or 400: a bearer JWT whose header says `alg: none`, and a NUL byte in a URL path. The boundary holds; the answer is not the contract's `problem+json` 401. The probes accept exactly that form and count it. Nothing to fix; devops may want to know it is a platform behaviour.
- **Schemathesis did not run** (see `docs/qa-reports/QA2-run.md`, "Not run"). That is a gap in verification, not a defect in the app. Class `env` for the orchestrator: installing Schemathesis needs approval in this session.
