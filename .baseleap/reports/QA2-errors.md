# QA2 tickets: permission probes and API boundaries on the staging preview

## Second ledger fuzz run at `dfaaa6c` (2026-11-24): no ticket; 2 contract amendments for bl-architect; the rest was fuzz configuration

**No new ticket. No product defect, no 5xx, no Critical.** 21 failures in 5 groups (anonymous 8, staff 13; jobs passed). Full table and evidence: `docs/qa-reports/QA2-run.md`, top section. Output: `tests/fuzz/last-run.txt`. The fuzz was not re-run. Product defects: none (the one candidate, a response-shape violation on `GET /quote-requests/{id}`, was a list page returned to a request the fuzzer built with an empty id, so the list route answered).

**Correction to the brief:** of the 3 "Rejected positive data" in the staff run, 2 are the `version` 422 (G3, G4) and 1 is the `cursor` 400 on `GET /quote-requests` (G5, CQ-QA2-2 from the first run, unchanged).

### Bucket 1, contract amendment (for bl-architect; the orchestrator rules because the contract is locked)

**CA-1: `version` has no upper bound (G3 `PUT /quote-requests/{request_id}/quote`, G4 `POST /quote-requests/{request_id}/status-changes`; closes CQ-QA2-1).**
Server: answers 422 `validation_failed` naming `version` above 2,147,483,647 (the BUG-QA2-4 ruling; backend validation `z.int().min(1).max(2_147_483_647)`; database column and both function arguments are `integer`). Contract: `minimum: 1` only. Schemathesis therefore sends large integers as valid input and calls the 422 "Rejected positive data". Change in `docs/openapi.yaml` (`components/schemas`):

```yaml
    QuoteSave:            # properties.version, line ~1164
        version:
          type: integer
          minimum: 1
          maximum: 2147483647      # add
    StatusChangeCreate:   # properties.version, line ~1174
        version:
          type: integer
          minimum: 1
          maximum: 2147483647      # add
```

For symmetry (no effect on the fuzz result), the same `maximum: 2147483647` on `QuoteRequestSummary.version` (~851), `QuoteRequestDetail.version` (~1023) and `StatusChangeResult.version` (~1189). Both operations already document 422 (`ValidationError`), so no response change. Side effects for the architect: the generated Zod schemas and fakers change (`src/lib/api/generated/*`). After it lands: values above the maximum are generated as negative data and must answer 422; a 409 for any of them would turn into "Accepted negative data", a product ticket. QA then tightens `PRB-45` from "409 or 422" to 422 for values above 2,147,483,647.

**CA-2: the cursor is "opaque" but only cursors this API issued are accepted (G5 `GET /quote-requests`; closes CQ-QA2-2).**
Server: `400 bad_request` for any cursor not exactly what it writes (`c1.` plus base64url of a UTC time and an id, 200 characters at most). The 400 is already documented on the operation. Change in `components/parameters/Cursor`:

```yaml
    Cursor:
      name: cursor
      in: query
      description: >-
        Opaque cursor from the previous page's next_cursor. A value this API did not issue
        (wrong prefix, not decodable, not the shape it writes) is refused with 400 bad_request.
      schema:
        type: string
        maxLength: 200
        pattern: '^c1\.[A-Za-z0-9_-]+$'     # add (prefix and alphabet of what the server issues)
```

**This will not by itself turn the staff run green.** A pattern cannot say "decodes to a calendar-valid time and a uuid", so the fuzzer still generates strings like `c1.AAAA` that match, are valid by the schema, and are rightly refused with 400: one "Rejected positive data" on `GET /quote-requests` remains. What closes it is a ruling that a 400 for a non-issued cursor is the contract; then QA switches `positive_data_acceptance` off for `GET /quote-requests` only (scoped in the fuzz config, no other operation, no other check) and says so in the report. Not done now: no check is excluded ahead of a ruling.

### Bucket 2, product defect: none

### Bucket 3, fuzz configuration (fixed in `tests/fuzz/**`; 18 of 21 failures)

**G1 (16) and G2 (2): an empty `request_id` makes the URL a different, valid route.** In the coverage phase Schemathesis sends an empty path id as negative data; the segment disappears:
- `POST /api/quote-requests/submission`, `PUT /api/quote-requests/quote`, `POST /api/quote-requests/status-changes`, `POST /api/quote-requests/ghl-copy-retries` hit `/quote-requests/{id}` with the id `submission` etc., which has no such method: **405 `method_not_allowed` problem+json**, the documented behaviour for an unlisted method (contract description, probed by `PRB-05`). Reported as "Undocumented HTTP status code" (405 not in the operation's list) and "Accepted negative data" (405 is not in Schemathesis's rejection statuses). 4 operations x 2 runs x 2 checks = 16.
- `GET /api/quote-requests/` (empty id, staff run) is the list route: 200 `{data, next_cursor}`, a valid list page. Judged against the detail schema: "Response violates schema" and "Accepted negative data". 2.

Repro of the cause (staff token not needed for the 405s): `curl -s -X POST "$STAGING_URL/api/quote-requests/submission" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"` gives 405. Not run in this session; it is the reproduction line Schemathesis printed.

Change: new `tests/fuzz/schemathesis.toml` pins `request_id` to a well-formed uuid no request has (`00000000-0000-4000-8000-000000000000`), and `tests/fuzz/run.mjs` passes it with `--config-file`. It was chosen over (a) documenting 405 on those operations, which would clear 8 of the 16 and leave the "accepted negative data" half, and put a status in the contract that no real request to them gets; (b) a `filter_path_parameters` hook, which Schemathesis 4.0.0 does not apply to coverage cases. **No check was excluded; `not_a_server_error` stays on.** Cost: the id itself is no longer varied by the fuzzer; `PRB-04` (malformed ids) and `PRB-05` (405s) cover it. Whether Schemathesis accepts the file is unverified until the next run.

### Expected next run (so that anything else is recognised as new)

Anonymous 0 failures; staff exactly the three "Rejected positive data" (version on `PUT quote` and `POST status-changes` until CA-1; cursor until CA-2 is ruled); jobs 2 of 2.

---

## Status, 2026-11-24 (2026-11-25 UTC): BUG-QA2-4 RESOLVED at `dfaaa6c`; no open ticket from the probes, no new ticket

- **Commit under test:** `dfaaa6cb35cb27d58086ced223fa4091096238ab`, from `/api/health` (status `ok`). **Staging URL:** https://northside-quotes-git-staging-baseleap.vercel.app
- **Run:** `npx playwright test tests/e2e/probes --grep "PRB-45|PRB-74b"` → 2 passed, 0 failed, 0 flaky (retries off). Evidence: `docs/qa-reports/playwright-results.json`, `docs/qa-reports/QA2-run.md` (status update at the top).
- **BUG-QA2-4: RESOLVED.** `PRB-45`: 24 requests (2 ids x 6 versions from 2147483647 to 1687381385382380550179543211573248 x `PUT quote` and `POST status-changes`) all 409 or 422 (404 allowed for the unknown id), problem+json, 422 names `version`, request unchanged, no 5xx. The regression test stays in the suite.
- **PRB-74b: pass** with the 9 new NUL and surrogate cases (`address`, `phone`, `email`, `website`, photo `content_type`) and the original cases. No ticket.
- **Still open, not tickets for the backend:** CQ-QA2-1, CQ-QA2-2, CQ-QA2-3 (contract questions for bl-architect, below). The Schemathesis fuzz has not been re-run at `dfaaa6c`; the ledger runs it.

## Schemathesis fuzz at `bb54c17` (2026-11-24, ledger run of `bash tests/fuzz/run.sh`): 1 product ticket, 3 contract questions, everything else was fuzz configuration

**No Critical ticket: no permission boundary was crossed.** Target `https://northside-quotes-git-staging-baseleap.vercel.app`, commit `bb54c17`, Schemathesis 4.0.0. Run output: `tests/fuzz/last-run.txt` (45 failures across the anonymous run, 28, and the staff run, 17; the jobs run passed 2 of 2). Full triage and per-operation counts: `docs/qa-reports/QA2-run.md`, section "Fuzz". `$STAGING_URL` is the preview above; `$VERCEL_AUTOMATION_BYPASS_SECRET` is sent as `x-vercel-protection-bypass`; `$STAFF_ACCESS_TOKEN` is an owner access token.

The 200 answers to `GET /staff/me` and `GET /weekly-counts/current` under "Missing header not rejected" are **not** an open route: Schemathesis's own header (`--header Authorization`) is sent again after the check removes it. Evidence: `PRB-01` sends no Authorization header at all to all 9 staff routes and gets 401 problem+json on every one, passing at this same commit `bb54c17`. The transport explanation is unverified directly (QA cannot read Schemathesis's code), but the 200 bodies were the owner's own data and `PRB-01` is the independent proof; the next ledger run keeps it.

### BUG-QA2-4: `PUT /quote-requests/{id}/quote` and `POST /quote-requests/{id}/status-changes` return 500 when `version` is a large integer

- **Severity:** Important (an authenticated staff route answers 500 to a body the contract calls valid; the body is the clean generic `internal_error`, nothing is stored or leaked).
- **Operations:** `saveQuote` (`PUT /quote-requests/{request_id}/quote`) and `changeQuoteRequestStatus` (`POST /quote-requests/{request_id}/status-changes`). One root cause, two operations.
- **Field that triggers it:** `version` (the other fields in each case were ordinary: `price_cents` 6895, `note` empty, `to_status` `new`). `version: 1` passes everywhere. Failing values seen: `367499305219` (saveQuote) and `10000000001` (status change), both above 2,147,483,647. The exact threshold is unverified (not bisected; the fuzz run is not re-run by QA).
- **Class and owner:** `server` (impl), **bl-backend**. The request id used was a random uuid that does not exist, so the failure happens before or instead of the "not found" answer: most likely the number is bound into a database function argument typed as a 32-bit integer and overflows (unverified, QA does not read code). The contract side is CQ-QA2-1 below.
- **Minimal reproducing requests** (staff token required; any uuid works, the request need not exist):
  - `curl -s -X PUT "$STAGING_URL/api/quote-requests/f2330d60-377e-ded3-54a9-c03e3122ff76/quote" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" -H "Authorization: Bearer $STAFF_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"note": "", "price_cents": 6895, "version": 367499305219}'`
  - `curl -s -X POST "$STAGING_URL/api/quote-requests/eb791f76-f29b-c0fb-6f33-8fee5e681922/status-changes" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" -H "Authorization: Bearer $STAFF_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"to_status": "new", "version": 10000000001}'`
- **Expected:** 409 `stale_version` (the number is not the current version) or 422 `validation_failed` naming `version` (if an upper bound is added); `application/problem+json` either way. A request an authenticated user can send must never be a 500 (qa-fuzz rule; `openapi.yaml` `InternalError` is "unexpected failure").
- **Actual:** `500 {"type":"about:blank","title":"Something went wrong","status":500,"code":"internal_error"}`.
- **Request ids:** not available. Schemathesis 4.0.0 does not print the Vercel id of a 500 and the problem body has none, and the junit report holds none. Two fixes so the next run has them: `tests/fuzz/run.mjs` now writes a HAR report and prints every 5xx with its `x-vercel-id`, and the regression test `PRB-45` prints it on each failing case. Seeds of the failing runs: staff run `176832961998963409097142393018833185738`.
- **Regression test (red until fixed, stays in the suite):** `tests/e2e/probes/50-staff-writes.probe.spec.ts` › `PRB-45` (2 request ids, an existing one and an unknown one, x 6 version values `2147483647`, `2147483648`, `10000000001`, `367499305219`, `9007199254740991`, `1687381385382380550179543211573248` x both writes = 24 requests; each must be 409 or 422 (404 for the unknown id), problem+json, no database text, and the request unchanged afterwards). The 5th and 6th values are beyond what JavaScript holds exactly, so a fix that parses the body as a JS number and rounds may still need attention; the test sends raw JSON text.
- **Signature suggestion:** `version-above-int32-returns-500-on-quote-and-status-writes`

### Contract questions (for bl-architect; not backend bugs)

- **CQ-QA2-1 `version` has no upper bound** (`QuoteSave.version`, `StatusChangeCreate.version`, and the `version` in `QuoteRequestSummary`, `QuoteRequestDetail`, `StatusChangeResult`: `type: integer, minimum: 1`, no `maximum`). The contract calls any integer valid, the database cannot hold all of them, and Schemathesis (correctly) sends the large ones as valid input. Suggested change: `maximum: 2147483647` if the column is a 32-bit integer (unverified: confirm in the migration). The server then answers 422 naming `version`, and the fuzzer generates the larger values as invalid input and expects a 4xx. The contract is locked at Gate 2 and this tightens a request constraint, so the orchestrator decides the route. Until it is decided, BUG-QA2-4's fix is the same either way: never a 5xx.
- **CQ-QA2-2 `cursor` is "opaque" but the server rejects most strings** (`components/parameters/Cursor`: `type: string, maxLength: 200`). `GET /quote-requests?cursor=0000...` (200 zeros, `status=new&q=0`) answers `400 bad_request`, which is documented for the operation and correct for a cursor the API did not issue. Schemathesis's positive-data check calls the input valid and reports "Rejected positive data" (case id `UhA8A7` in the staff run). Suggested change: give the cursor a `pattern` (its alphabet, for example base64url) or state in the description that a value that is not a cursor from this API is `400 bad_request`, whichever the architect prefers. QA kept the check on for this operation rather than hide it, so the staff run stays red on this one finding until the contract changes. Not a backend bug.
- **CQ-QA2-3 (Minor, wording) requests the hosting platform refuses are not in the contract.** The description says a method that is not listed "returns 405 with a problem body (code method_not_allowed)". For `TRACE` Vercel itself answers before the app runs: `405`, plain text `Method not allowed / NOT_ALLOWED / <request id>`, no `Allow` header (9 operations in the anonymous run, 1 in the staff run). The same platform layer answers `400 Bad Request` as plain text to header values with non-ASCII bytes. Suggested change: add one sentence "Requests the hosting platform refuses before the app runs (the TRACE method, header values with non-ASCII bytes) get the platform's plain-text 400 or 405, which this contract does not describe". Request ids of the TRACE answers: `yul1::dwlql-1795576051383-e28256e056bf` (list), `yul1::xjw2k-1795576054932-7e8154da5b9f` ({id}), `yul1::9b4gx-1795576058533-1face02d5184` (health).

### Not tickets: fuzz configuration noise, fixed in `tests/fuzz/run.mjs` (detail in `docs/qa-reports/QA2-run.md`)

| What Schemathesis reported | Count | Why it is not a product defect | What changed |
|---|---|---|---|
| Plain-text `400 Bad Request` reported as "Undocumented Content-Type", "Undocumented HTTP status code" and "Rejected positive data" | 12 cases (anonymous 10, staff 2); 7 of the 10 anonymous ones also appear as "Rejected positive data" | The app answers a bad request with `problem+json` (the staff run shows it: `bad_request`). A plain-text `400 Bad Request` is the platform's. Every one carries a header value Schemathesis invented (a random `Authorization`, a random `X-Form-Token`, random header names) with non-ASCII bytes. **Inferred, not proven**: Schemathesis hides the generated value. | The three identity headers are now fixed per run (junk bearer / owner token / wrong cron secret; one unsigned but well-formed form token). If a plain-text 400 still appears with these fixed ASCII headers, it is a real finding and must be ticketed. |
| "Unsupported method incorrect response" (`TRACE`) | 10 | The platform answers `TRACE` itself (see CQ-QA2-3). The app's own 405 with `Allow` is probed with 16 methods in `PRB-05`, passing. | Check `unsupported_method` off. |
| "Missing header not rejected" | 11 | Anonymous run: `X-Form-Token` removed, the app answers the documented 401 `form_token_invalid`, the check expects 406. Staff run: false positive, see the top of this section. | Check `missing_required_header` off. The 401 rows stay proven by `PRB-01`, `PRB-31`, `PRB-34`. |
| "Missing authentication" and "Missing test data" warnings | "Missing authentication": anonymous 6 operations, staff 2, jobs 2. "Missing test data" (404): staff 5 operations | Warnings, not failures. The anonymous and jobs runs are meant to get 401. In the staff run the create and submission routes get the documented 401 for a form token the fuzzer cannot sign, and the five `{request_id}` routes get 404 for random uuids. | Nothing to fix. Depth limit recorded in the run report. |

---

## Earlier probe re-run at `bb54c17` (2026-11-24): all three tickets RESOLVED, no open ticket, no new ticket

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
