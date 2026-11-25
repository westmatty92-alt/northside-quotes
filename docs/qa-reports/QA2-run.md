# QA2 run report: permission probes, API boundaries and fuzz

**Verdict: FAIL.** No permission boundary was crossed (no Critical finding). 50 of the 54 probes pass. 4 fail on **3 real bugs** (2 Important, 1 Minor), each now a failing regression test that stays in the suite. The **Schemathesis fuzz run did not run** on this machine (it cannot be installed here and `bash tests/fuzz/run.sh` is refused by the permission system), so there is **no fuzz result and no fuzz pass**.

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Commit under test:** `42208a49aaaf21477fd369360f6a17caed80254f` (`42208a4`, read from `/api/health` by `PRB-00`, status `ok`) · **Step:** QA2 · **Date:** 2026-11-24 evening local (2026-11-25 UTC) · **Run type:** full probe run, once (`npx playwright test tests/e2e/probes`, 52 tests, 19.2 minutes, run id `gqutp`), then three probes run alone.

The ledger's own form, `node --env-file=.env.local node_modules/.bin/playwright test tests/e2e/probes`, is **refused in this session** ("This command requires approval", the same as in QA1). `playwright.config.ts` loads `.env.local` itself, so `npx playwright test tests/e2e/probes` runs the same tests.

Evidence: `docs/qa-reports/playwright-results.json` (JSON of the full run; it replaces the QA1 and visual runs' file of the same name) and `playwright-report/` (HTML). Traces and videos of the 4 failures are in `test-results/` (git-ignored: they hold the bypass header, do not share). The probe sources are in `tests/e2e/probes/`.

## Counts

| | Tests | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|---|
| Full run `gqutp` (all probes that existed when it started) | 52 | 48 | 4 | 0 | 0 |
| Run alone afterwards: `PRB-00` (commit), `PRB-44` (invalid text in staff inputs, added after the full run) | 2 | 2 | 0 | 0 | 0 |
| **Suite today** | **54** | **50** | **4** | **0** | **0** |

Retries are off for the `probes` project (most probes spend the 5-per-10-minutes submission limit or a sign-in count, and a retry would change what is measured), so nothing can be "flaky": a failure is a failure. `PRB-75` was also re-run alone to record how the server answers (below). Every earlier run in this session was a development run of the same files; the failures in them were fixed in the probes or are the three tickets here.

## Results per probe area

| Area | Probes | Result | What was proven (and how many requests) |
|---|---|---|---|
| **No session, 401** | PRB-01, 02, 03 | pass | All 9 staff routes with 7 kinds of missing or useless credential (no header, empty bearer, `Bearer undefined`, `Bearer null`, garbage, Basic, the public anon key): 63 requests, all 401 `problem+json` with a documented code, no cookie, no database text. Forged tokens (changed signature, `alg: none`, edited role, edited subject, truncated): refused, 6 of the 21 calls by Vercel's own edge with a plain 403 before the app ran (see "Notes"). A valid session **cookie** without the bearer token is refused on every route (no CSRF surface). Owner and helper tokens work (positive controls), so the 401s are not a blanket refusal |
| **Unknown ids, methods** | PRB-04, 05 | pass | Unknown request ids: 404 `not_found` on all 5 staff operations. Malformed ids (`not-a-uuid`, path climbs, SQL text, 300 characters, emoji): 400/404/422 `problem+json`, never 5xx, never database text; the NUL-byte id is refused by Vercel's edge (400). Methods the contract does not list (DELETE, PATCH, PUT, POST on the wrong paths, 16 of them, plus 3 method-override headers): 405 `method_not_allowed` with `Allow`. A request can never be deleted |
| **Mass assignment** | PRB-40, 75 | pass | Create with all ten extra fields (`status`, `price_cents`, `reference`, `marketing_consent_at`, `id`, `ghl_contact_id`, `state`, `submitted_at`, `version`, `submission_key`): **422 `validation_failed`, naming every one of them; nothing created**. Each one alone is refused the same way. Staff `PUT quote` and `POST status-changes` with extra fields: refused or ignored, re-read shows status, reference, consent, id and submitted time unchanged |
| **Direct Supabase, anon key** | PRB-20, 21, 24, 25, 26 | pass | All 10 tables: select, insert, update and delete refused 401/403 (no privilege on any table); the REST root lists nothing. All 10 service-only functions and all 6 staff functions refused (execute revoked). `app_private`, `auth` and `storage` are not exposed through REST. Supabase Auth: sign-up, anonymous sign-in and one-time-link creation are off (`disable_signup` true, only the email provider on); nothing was created |
| **Direct Supabase, staff token (owner and helper)** | PRB-22, 23, 24, 28 | pass | Staff read exactly the six tables the matrix allows and are refused the four counter tables; pending and reference-less requests are invisible; `events` and `ghl_sync_jobs` hold no email, phone or 64-hex hash. No staff write to any table (insert, update, delete: all 403); service-only functions refused for both roles. A staff token **stops working at once when its session is signed out**: the API answers 401 and REST returns no rows (checked on a fresh helper session ended with `scope=local`) |
| **Storage** | PRB-70 to 73 | pass | Anon uploads only into a pending request's own folder at planned positions. Refused: a 4th photo in a full folder, `photo-0`, an upper-case name, a nested path, another folder, the bucket root, a path that climbs out, an unplanned position, another bucket, overwrite (upsert), delete, bulk delete, copy, move, list. Every read of an **unsubmitted** photo (6 addresses, a signed URL, a batch of signed URLs, staff and anon) fails; the app and REST treat the pending request as nonexistent. Oversize (5,242,881 bytes) and wrong types (PDF, SVG, HTML, octet-stream) refused by the bucket. A text file named like a JPEG is accepted by the bucket, **refused at submit with 422 `photo_invalid` naming `photos[1]`, deleted** (the position took a real photo straight after), and the request stayed invisible. After submit: signed URLs last 900 seconds, return an image, and fail without their token or with a changed one; no direct address works without sign-in (private, public and authenticated forms, with the anon key and with no key); the folder is closed to uploads |
| **Rate limit** | PRB-30 to 32 | pass | **20 parallel creates from one address: exactly 5 accepted (201) and 15 refused (429)**, each 429 with `Retry-After` (whole seconds, 1 to 600), code `rate_limited` and the documented message. Exactly the 5 accepted were stored, none of the 15. One `rate_limited` spam event gained a count of 15. 30 honeypot submissions: all 30 refused 400 with identical bodies, nothing stored, **one** spam event with count 30, carrying only `reason` and `count` (no request, user or address). The under-3-seconds refusal body is identical to the honeypot's. Missing, empty, garbage, forged, future and expired-looking form tokens: 401 `form_token_invalid` |
| **Consent (AC-001.17)** | PRB-33 | pass | All 5 requests stored from a create with offers value `"maybe"`: consent no, no consent time, copy state `not_copied_no_consent`, no stage tag. Replay of the same token with `"true"`, `"TRUE"`, `"yes"`, `"on"`, `1`, `0`, `null`, `false`, `[]`, `{}`, `[true]` is the same request (200); only JSON `true` is a different answer (409 `form_already_used`); a changed name is 409; consent and name did not change |
| **Sign-in limits** | PRB-50, 51, 52 | pass | One throwaway email (no account): attempts 1 to 5 are 401 `invalid_credentials` with one body; **attempts 6 to 20 are 429 `sign_in_paused` with one body and no `Retry-After`** (nor any `RateLimit` header); the owner could still sign in afterwards. `next` after sign-in: `/pipeline` is followed; `//evil.example`, an absolute URL, a backslash form, encoded slashes and `javascript:` all land on `/requests`, and the browser never contacted `evil.example` |
| **Job routes** | PRB-10, 11 | pass | Both cron routes, 28 requests (no header, empty, `Bearer undefined`, `Bearer null`, `Bearer ` with and without the space, lower case, `Token`, Basic, 32 x, 64 a, a staff token, the anon key) plus spoofed `x-vercel-cron`, a cron user agent, secrets in the query string, and POST, PUT, DELETE, PATCH: every one 401 (or 405), no job counts in the body. The correct-secret path was **not** exercised (QA holds no `CRON_SECRET`) |
| **Stored script text** | PRB-43 | pass | Script text in name, address, problem (homeowner) and the staff note shows as text on the Requests list, the Pipeline board and the detail, on a 390 px phone and a 1280 px desktop. `window.__xss` stayed undefined, no `onerror` attribute or `<img src="x">` appeared, no dialog opened, no console error |
| **Headers, CORS, bundles** | PRB-60 to 62 | pass | Every page: nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`, `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, no unsafe-eval or unsafe-inline for scripts, a different nonce per load; `X-Frame-Options: DENY`, `nosniff`, referrer policy. No `Access-Control-Allow-Origin` or credentials header on the API, the form routes or the job routes (actual calls and preflights). 22 pages and scripts (public, and every script a signed-in staff browser loads on the three staff screens) hold no `service_role`, Stripe key, private key, GoHighLevel token, server-variable name, or the value of any of 2 real secrets held on this machine; every JWT shipped has role `anon` |
| **Contract conformance (not Schemathesis)** | PRB-63, 64, 66, 67, 68 | pass | 25 GET responses (health, staff/me, weekly count, 3 pages of the list, each status filter, search, 12 details, the photo lists) parse against the schema generated from `docs/openapi.yaml` with **no undocumented field**; the checker itself is proven to report an extra field, a missing one and a wrong value (PRB-67). Problem bodies: HTTP status equals body status, code is documented. 15 bad list parameters are 400/422; 13 search strings that look like filters or SQL never reach the database as filters and never 5xx; personal-data responses are `no-store` or `private` |
| **Create-route input** | PRB-74, 74b | **74 pass, 74b FAIL** | Every valid edge is accepted on one pending request (name 2 and 100, address 5 and 200, problem 10 and 2000, 254-character email, 4 phone shapes, 3 urgencies, 0, 1 and 3 planned photos); the same token under 3 seconds is refused and after 3 seconds accepted (AC-003.3). 38 invalid inputs are 422 and name the field. NUL characters, SQL text and filter text are handled. **An unpaired surrogate in `name`, `problem` or `address` is a 500** (BUG-QA2-2) |
| **Unknown routes and password routes** | PRB-06, 06b | **FAIL** | Unknown `/api/*` and page paths answer **200 with the app's HTML** for any POST, PUT or DELETE, and for a GET that carries an `Authorization` header (BUG-QA2-1) |
| **Sign-in body type** | PRB-08 | **FAIL** | `POST /api/auth/sign-in` with `Content-Type: text/plain` is processed as JSON (BUG-QA2-3) |

PRB-76 (the run left only its 7 stored requests visible and the pending boundary request invisible) and PRB-41 and PRB-42 (staff write boundaries, copy retry on an unticked request is 409 `not_retryable`) also pass; PRB-41 checks 17 invalid or stale `PUT quote` bodies, 8 invalid or stale status-change bodies, malformed JSON (400), 7 valid edges stored exactly as sent (price 1 and 9,999,999, a 1,000-character note, emoji, script text, explicit `null` for both optional fields, an empty note), and that each 200 body conforms to the contract.

## Permission matrix (docs/SECURITY_MODEL.md) against probes

| Row | Probe | Result |
|---|---|---|
| `quote_requests`: anonymous creates a pending request only through the API; no table access | PRB-20, 21, 32, 75 | pass |
| `quote_requests`: staff read submitted rows only, write only through the RPCs, never delete | PRB-22, 23, 05 | pass |
| `quote_photos`, Storage `quote-photos` (insert own pending folder, at most 3, no read, staff read recorded objects only) | PRB-70 to 73 | pass |
| `quote_request_status_changes`, `ghl_sync_jobs`, `events`, `staff`: staff read, nobody else, no client write | PRB-22, 23 | pass |
| Counter tables (`rate_limit_hits`, `spam_refusal_windows`, `sign_in_attempts`, `sign_in_pauses`): no client access | PRB-20 to 23 | pass |
| Passwords: no change or reset route, no app way, nothing sent | PRB-06, 06b, 26 | **FAIL on the status code only** (BUG-QA2-1): no such feature exists and nothing was sent, but the paths answer 200, not 404 |
| Staff routes with no session or a non-staff session | PRB-01, 02, 03, 28 | pass |
| "Non-staff signed in": sign-up and anonymous sign-in are off, so none can exist; the anon key and a signed-out token are refused | PRB-26, 28, 01 | pass |
| `POST /api/quote-requests` and `.../submission` need a valid form token | PRB-31, 34 | pass |
| `POST /api/auth/sign-in`: per-email limit, one body, no `Retry-After`, fails per throwaway email | PRB-50, 51 | pass |
| `GET /api/jobs/*`: 401 for everyone without the secret | PRB-10, 11 | pass |
| `GET /api/health`: allowed for all | PRB-00 | pass |

## Tickets

Full text with reproduction in `.baseleap/reports/QA2-errors.md`. No Critical ticket.

| Ticket | Severity | Suggested owner | Class | Failing probes |
|---|---|---|---|---|
| BUG-QA2-1 Unknown paths answer 200 with the app's HTML (POST, PUT, DELETE, and GET with an Authorization header), including the password and reset paths | Important | bl-backend (bl-frontend if the not-found page is theirs) | server | PRB-06, PRB-06b |
| BUG-QA2-2 `POST /api/quote-requests` returns 500 for an unpaired surrogate in name, problem or address | Important | bl-backend | server | PRB-74b |
| BUG-QA2-3 `POST /api/auth/sign-in` accepts `Content-Type: text/plain` (a request a browser can send from another site without a preflight) | Minor | bl-backend, bl-security to rate | server | PRB-08 |

## Test data left on staging

Requests cannot be deleted through the app (NG-7). Baseleap removes them by name prefix `QA-PROBE`. Each name carries script text on purpose. Nothing was sent to GoHighLevel (every request has offers consent no).

| Run id | Visible to staff | Pending only (never submitted, purged by housekeeping after 24 hours) |
|---|---|---|
| `ga07q` (development run of the form probes) | NQ-PMPDGG, NQ-9MQ2XN, NQ-UUVWG7, NQ-ZGD4TP, NQ-U33V2K | none |
| `gbfld` (development run of the storage probes) | NQ-GFWPUV (A), NQ-JB39RN (B) | 1 boundary request |
| `gqutp` (the full run above) | NQ-8D9SRW, NQ-4GB27A, NQ-3C5EWA, NQ-Y5UCSD, NQ-4C6287 (the burst); NQ-2ND3G3 (A), NQ-YXXGXP (B) | 1 boundary request |

That is 14 visible requests and 2 pending ones. The same list, with times, is in `tests/e2e/probes/created.ndjson`. `docs/qa-reports/qa-e2e-created.ndjson` was **not** touched (the `probes` project has no dependency on QA1's `setup`, which would empty it).

Other traces on the shared staging project: the `events` table gained `spam_submission_blocked` rows (honeypot, too fast and rate limited, one window each per run); `sign_in_attempts` gained 5 failures per run for throwaway emails of the form `qa-probe-<run id>-lock@example.test` (no account, purged after 24 hours); no real staff email was ever used for a failed sign-in, and the owner and helper were used only for successful sign-ins (the helper also for one sign-in followed by the sign-out of that one session).

## Not run, or not proven (unverified)

- **Schemathesis fuzz: not run, no counts.** `tests/fuzz/run.sh` and `tests/fuzz/run.mjs` are written (three runs: anonymous, staff token, job routes with the 401 only; 20 examples per operation, one worker, 5 requests a second; secrets redacted from every output line; staging-only guard) but **untried**: the commands that would install or run Schemathesis were each refused with "This command requires approval": `python3 -m venv .baseleap/tools/venv-schemathesis`, `pipx run --spec schemathesis schemathesis --version`, `docker run --rm schemathesis/schemathesis:latest --version`, `python3 -m pip --version`, and `bash tests/fuzz/run.sh` itself. There is no `uv` or `uvx` on the machine. Without Schemathesis `run.sh` exits **3** with "NOT RUN ... This is not a pass". The flags are from Schemathesis 4 documentation and were never executed, so expect one round of corrections on the first real run.
- **Per-address sign-in limit (AC-004.11):** not driven. Twenty failures from this machine would pause this address for 15 minutes for every agent signing in on the shared preview. Each full run adds 5 failures to that count.
- **AC-004.5 with the real account** (right password after 5 minutes) and AC-004.12's "same message for a real account": not run (the rule: no failed sign-ins for the owner or helper). Covered for an unknown email only.
- **AC-004.13 and AC-003.5** (counters unreadable): cannot be induced from outside. **AC-003.8** (1,000 events a day): not run (it would write 1,000 rows).
- **The cron routes with the correct secret** (200 and job counts): QA holds no `CRON_SECRET`.
- **Seven-day session expiry:** cannot be waited out; the sign-out revocation (PRB-28) uses the same `is_staff()` session check and passes.
- **IPv6 /64 keying** of the limits: the address family of this machine was not checked; IPv4 behaviour only is proven.
- **Embed handoff:** no screen is embedded (NG-11); `X-Frame-Options: DENY` and `frame-ancestors 'none'` are verified.
- **GoHighLevel:** no request had consent, so no GHL call was made or checked; live GHL stays unverified (as in QA1).
- Whether Vercel's edge refusals (below) are a project setting or a platform default.

## Notes

- Vercel's own edge refuses some hostile requests itself, before the app runs: a JWT whose header says `alg: none` (plain 403 "Forbidden") and a NUL byte in a path (plain 400). The boundary holds (no data), but the answer is not the contract's `problem+json` 401. The probes accept this only in exactly that form (`server: Vercel`, `text/plain`, 400 or 403) and count it; 6 of 21 forged-token calls and 5 malformed-id calls took this route in the full run.
- `playwright.config.ts` has one new project, `probes` (no dependency on `setup`, retries 0), so the ledger's `playwright test tests/e2e/probes` finds the tests.
- `docs/test-plan.md` still says the permission rows live in `tests/e2e/api/permissions.spec.ts`; they are in `tests/e2e/probes/*.probe.spec.ts` (not edited here: outside this step's files).
- QA1's `platform.both.spec.ts` still expects commit `0dff609`; staging is at `42208a4`, so that one platform check will fail until its default is updated (QA1's file, not touched).
- A full probe run takes about 20 minutes: after the 20-parallel burst uses the whole 10-minute window, the storage probes wait for it to age out. The wait is the limit being honoured, kept in `playwright/.cache/submission-slots.json` (shared with QA1). Never run the probes and QA1's suite from two machines at once.
