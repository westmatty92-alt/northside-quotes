# STEP BE1 — Backend platform + public submission
## Attempt 1 — 2026-11-20
**Status:** done (all five verify commands exit 0; details and two honest gaps below)

**Lane:** `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend` (`lane/backend`). No git commands were run; the orchestrator commits.
**Database:** every staging-backed test ran against the shared staging Supabase project (hosted, ca-central-1), never production and never the local stack.

## Assumptions (and calls I made where the docs are silent)
1. **IPv6 /64 key format** is `2001:db8:0:0` (first four hextets, lower-case, leading zeros dropped); IPv4-mapped IPv6 counts as its IPv4. SECURITY_MODEL says "first four hextets" without a text form, so this is pinned in `tests/api/submission/network.test.ts`. BE2 must reuse `addressHash()` so sign-in and the form hash the same way.
2. **Honeypot:** anything other than missing, `null` or `""` in `website` is refused (so `123`, `true`, `" "` are refused too, never a 422).
3. **Time trap on submit:** a token under 3 s on `submitQuoteRequest` is refused like the honeypot and recorded as `too_fast` (the creating token is always older, so this only matters for a foreign token).
4. **A planned photo that never arrived** is `photo_missing` and is recorded as `photo_upload_failed` with reason `storage_error` (metrics-spec has only too_large, bad_type, storage_error). A PNG/WebP over 12,000 px is `too_large`.
5. **NUL character** in name, email, address or problem is a 422 on that field (not in the brief). Postgres text cannot hold NUL and PostgREST would answer a non-23514 error, which would have been a 500 for something the homeowner typed.
6. **`request_id` is in the `x-request-id` header only, not in the problem body.** The contract's Problem schema does not list it and refusal bodies must be byte-identical (invariant 8). The be-testing skill suggests it in 500 bodies; I kept the contract exact.
7. **Body over 64 KB or not JSON** is 400 `bad_request`.
8. **Clearing uploads fails after an `updated` outcome** gives 503; the row is already updated, so the retry replays (200) without clearing. Safe because submit re-checks every photo's bytes.

## Files created or changed
Source (all under the lane):
- `src/lib/server/env.ts` — replaces A2's stub, same exports (`MIN_SECRET_LENGTH`, `SecretName`, `EnvConfigError`, `appSigningSecret`, `cronSecret`); adds `hmacHex()` and `isCronRequest()` (constant-time Bearer check that never throws)
- `src/lib/server/form-token.ts` — replaces A2's stub, same exports; `verifyFormToken` now real (constant-time signature, then 3 s / 24 h window)
- `src/lib/server/log.ts` — new: allow-listed JSON log line, value shapes checked per field
- `src/lib/server/http.ts` — new: `withApi`, `ProblemError`, problem+json, PostgREST mapping (`dbProblem`), `errorFields`/`dbErrorFields`, `methodNotAllowed`, `readJsonBody`
- `src/lib/server/events.ts` — new: `recordSpamRefusal`, `recordPhotoUploadFailed` (best effort)
- `src/lib/server/services/network.ts` — new: client address, /64 cut, address hash
- `src/lib/server/services/photo-check.ts` — new: pure magic-byte / size / dimension check
- `src/lib/server/services/submissions.ts` — new: `startQuoteRequest`, `completeQuoteRequest`, `removeRequestUploads`
- `src/lib/server/jobs/housekeeping.ts` — new: the purge
- `src/app/api/health/route.ts` — replaces A2's (now wrapped; 405 for other methods)
- `src/app/api/jobs/housekeeping/route.ts` — new
- `src/app/api/quote-requests/route.ts` — new (POST only; BE3 adds GET here)
- `src/app/api/quote-requests/[request_id]/submission/route.ts` — new

Tests and helpers:
- `tests/helpers/staging-env.ts`, `tests/helpers/staging.ts`, `tests/helpers/api.ts`
- `tests/unit/env.test.ts`
- `tests/api/submission/`: `form-token.test.ts`, `network.test.ts`, `photo-check.test.ts`, `http-log.test.ts`, `staging-env.test.ts`, `create.test.ts`, `create-failures.test.ts`, `rate-limit.test.ts`, `submit.test.ts`
- `tests/api/housekeeping/housekeeping.test.ts`
- `tests/api/health/health.test.ts`
- `.baseleap/reports/BE1.md` (this report)

Not touched: `src/lib/server/admin.ts` (A2's file is already correct and lazy), `supabase.ts`, `session.ts`, the integration seam `src/lib/server/integrations/ghl/index.ts` (A2 no-op stub, same signature), migrations, openapi, generated code, `package*.json`, `vitest.config.ts`. `supabase/seed.sql` was **not** created: this step's description does not call for it.

## Commands run (each with `cd <lane> &&` prefix)
| Command | Result |
|---|---|
| `npm ci` | exit 0, 596 packages, 0 vulnerabilities (run first) |
| `npm run typecheck` | exit 0 (`next typegen && tsc --noEmit`, tests included) |
| `npm run lint` | exit 0, 0 errors, 2 warnings, both pre-existing and not in my files (`scripts/lib/yaml-lite.mjs:136`, `scripts/sync-agent-permissions.mjs:36`) |
| `node --env-file-if-exists=.env.local node_modules/.bin/vitest run <paths>` | **refused by the sandbox** (approval prompt, non-interactive), so I used the sanctioned fallback below |
| `npx vitest run tests/api/submission tests/api/housekeeping tests/api/health tests/unit/env --passWithNoTests=false` | exit 0, **12 files passed, 184 tests passed, 0 failed, 0 skipped** (vitest prints a skipped count only when it is above zero; none printed). Re-run three times in a row against staging, all green. |
| `npm run build` | exit 0 (routes: `/api/health`, `/api/jobs/housekeeping`, `/api/quote-requests`, `/api/quote-requests/[request_id]/submission` all dynamic) |
| `node scripts/check-code-guards.mjs service-role` | exit 0, `OK` |

Per-file test counts: `tests/unit/env.test.ts` 8 · `form-token` 9 · `network` 11 · `photo-check` 6 · `http-log` 21 · `staging-env` 7 · `create` 53 · `create-failures` 19 · `rate-limit` 8 · `submit` 18 · `housekeeping` 17 · `health` 7 = 184.

**Staging env handling:** `tests/helpers/staging-env.ts` loads the four names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STAGING_DB_URL`) with `process.loadEnvFile()` only when absent, from this checkout, then the main checkout found with `git rev-parse --git-common-dir` (fallback: the known path). It keeps only allow-listed names and never prints a value. Each staging-backed file throws in `beforeAll` when a name is missing, so it fails and never skips (proved in `staging-env.test.ts`). `APP_SIGNING_SECRET` and `CRON_SECRET` are random per test file; none is stored anywhere.

**Mutation checks** (done, then reverted; the verified tree is the final one): (1) cron check failing open when the secret is unset: 7 tests failed across `env.test.ts` and `housekeeping.test.ts`; (2) scheduling the GHL attempt even when no job was queued: 3 `submit` tests failed; (3) never passing the address hash: 6 tests failed in `rate-limit` and `create-failures`.

**Staging hygiene:** every file tracks what it creates and deletes it in `afterAll`, then asserts nothing is left (requests, files, counters, spam windows, and the events deleted through `psql`). The service role cannot delete `events`, so spam-refusal events (which hang off no request) are removed with `psql` on `SUPABASE_STAGING_DB_URL` (URL passed as an argument only, never printed). That makes `psql` on PATH and that variable required for the tests, which fail without them. One caveat: the housekeeping test runs the real job, which purges **all** staging rows older than 24 hours, exactly as the cron would; counts are therefore asserted as "at least what this file inserted".

## Acceptance criteria → tests
Step acceptance (from the ledger entry):
- **Every response matches the contract schema; 4xx bodies are problem+json** → every 2xx parsed with the generated Zod schema (`CreateQuoteRequestResponse`, `SubmitQuoteRequestResponse`, `RunHousekeepingResponse`, `GetHealthResponse`) in `create`, `submit`, `housekeeping`, `health`; every 4xx/5xx goes through `expectProblem` (content type `application/problem+json`, body parsed with the contract's Problem shape and code enum, `x-request-id` present).
- **AC-001.17 (consent coercion, no 422)** → `create.test.ts` "marketing_consent %s is stored as false with no 422" for `"maybe"`, `1`, `0`, `null`, `"true"`, `"yes"`, `false`, an object, an array, plus a body with the key missing; `true` stored as true; asserted in the database row.
- **Forced 23514 leaks no name, phone or email (SEC-5)** → `create-failures.test.ts` "forced 23514": an injected PostgREST error whose `details` carries the failing row; response and every captured console/stdout line are checked for the name, phone, email and address and for `Failing row|violates|check constraint|relation`; the one log line has exactly `{level, request_id, route, method, status, duration_ms, outcome, error_class: 'postgrest', code: '23514'}`. Also `create.test.ts` "a 422 response and its log line hold none of the submitted…" on the live database.
- **Bearer undefined, empty, missing → 401 on `/api/jobs/housekeeping`; short `APP_SIGNING_SECRET` → 503 on create and submit** → `housekeeping.test.ts` (no header, `Bearer `, `Bearer undefined`, wrong secret, no scheme, lower-case scheme; and with `CRON_SECRET` unset, empty or 31 characters, even a matching header; nothing purged by refused calls) and `tests/unit/env.test.ts`; 503: `create.test.ts` and `submit.test.ts` ("APP_SIGNING_SECRET unset / empty / 31 characters").
- **20 parallel creates from one address accept exactly 5 (staging)** → `rate-limit.test.ts` "S0 SEC-3": exactly 5 × 201 and 15 × 429, 5 `rate_limit_hits` rows, one spam window with `refusals` 15 and one event `{reason: rate_limited, count: 15}`.

Story acceptance criteria this step serves:
- **AC-001.1 / .15** (new request, offers box unticked, reference, status New, consent no) → `create` "answers 201…", `submit` "no photos, offers box left as loaded".
- **AC-001.2, .3, .4, .16** (validation names each field; 9/10/2,000/2,001 characters; phone `12345`, email `dana@`; empty email with ticked box) → `create` "AC-001.2", "AC-001.3", "AC-001.4", "AC-001.16".
- **AC-001.5** (script text stored as typed) → `create` "a name with script text is stored exactly as typed". Rendering as text is FE.
- **AC-001.6** (double tap is one request) → `create` "two taps at the same moment resolve to one request"; `submit` "two submits at the same moment…" (one event, one job, one photo set, one GHL attempt).
- **AC-001.7** (same phone twice is two requests) → `create` "AC-001.7".
- **AC-001.8** (database unreachable: designed 503, nothing stored) → `create-failures` "AC-001.8" (empty code, `08006`, `57014`, `PGRST002`, unconfigured client).
- **AC-001.14** (ticked: consent yes, consent time equals the stored time) → `submit` "offers box ticked" (`marketing_consent_at === submitted_at`), `create` "AC-001.14".
- **AC-002.1, .3, .4, .5, .6** (photos stored by type; exactly 5,242,880 bytes accepted; text renamed to .jpg refused; no photos fine; send again completes) → `submit` "photos are checked by their bytes", "AC-002.3", "AC-002.4", "no photos", and the retry steps in "a bad or missing photo…". AC-002.2 (4th photo) and the size/type plan limits → `create` "AC-002.2 to AC-002.4" (photo plan 422s). AC-002.3 note: the bucket itself refuses 5,242,881 bytes (asserted), the server check is unit-tested in `photo-check.test.ts`.
- **AC-003.2, .3** (honeypot and time trap are identical refusals, store nothing, never say which) → `create` "AC-003.2" (response bytes identical, body equals the contract example exactly), "AC-003.3".
- **AC-003.4** (5 accepted, 6th refused, with Retry-After) → `rate-limit` "AC-003.4"; replay takes no slot; other address and other /64 unaffected; IPv6 /64 end to end.
- **AC-003.5** (an unreadable counter never blocks a homeowner) → `rate-limit` "AC-003.5": no address at all gives 7 of 7 accepted; honeypot and time trap still apply; the database call itself accepts a request whose hash cannot be counted. `create-failures` checks `p_ip_hash` is null with no address.
- **AC-003.7** (30 honeypot refusals, one event, count 30, no address in it) → `create` "AC-003.7" (event properties are exactly `{reason, count}`; neither the address nor its hash appears in the event).
- **AC-009.9** (unticked: no GHL call, no job) → `submit` "no photos, offers box…": zero `ghl_sync_jobs` rows and `runGhlJobs` never called; the ticked case queues one `contact_copy` job and calls `runGhlJobs({ requestId })` once, never twice on a replay.
- **US-002 / US-003 / US-004 housekeeping** → `housekeeping.test.ts` (stale pending request and its file, old hits, spam window, sign-in attempt and pause purged; newer rows, an old *submitted* request, and every spam event kept; 500 when the database is unreachable).
- **Not covered here:** AC-003.8 (the 1,000-a-day event cap) is exact in `supabase/tests/functions/submission_and_limits.sql` (pgTAP); reproducing 1,000 events on shared staging from a route test would pollute it, so I did not.

Auth matrix for this step (all public or cron routes): no token → 401 `form_token_invalid` · tampered token → 401 · token of another request on submit → 401 · expired → 400 `form_expired` · too young → 400 `submission_refused` · unknown/malformed id → 404 · wrong method → 405 with `Allow` · short/unset signing secret → 503 · cron: no/empty/`undefined`/wrong → 401. Staff-authenticated routes are BE2/BE3.

Key query plans (be-data §5): BE1 adds **no list or search query**. `EXPLAIN` was **not run** (no psql from this session; unverified). By reading: the stale-pending purge (`state = 'pending' and created_at < cutoff order by created_at limit 100`) matches `quote_requests_pending_created_idx`. The four counter deletes filter on `created_at < cutoff` alone; the indexes lead with `ip_hash`/`email_hash`/`key_hash`, so these are full scans of tables that are bounded to about 24 hours of rows by this very job (finding for the architect, low severity).

## Notes for the next steps
- **BE2 (sign-in):** reuse `addressHash(clientAddress(req.headers))` from `src/lib/server/services/network.ts` and `hmacHex('email|v1|…')` from `env.ts`; `withApi`, `ProblemError`, `dbProblem` and `unavailable()` are in `http.ts`. Sign-in's EnvConfigError is already mapped to 503 `service_unavailable` by `withApi`; for `sign_in_unavailable` throw `new ProblemError(503, 'sign_in_unavailable')`.
- **BE3:** `src/app/api/quote-requests/route.ts` exports POST and 405 handlers for PUT/PATCH/DELETE only; add GET there. Until then a GET falls to Next's bare 405 (no problem body).
- **INT2:** `isCronRequest(req.headers.get('authorization'))` in `env.ts` is the Bearer check (never throws; `Bearer undefined`/empty/missing are false); throw `new ProblemError(401, 'unauthorized')` and wrap with `withApi`. In `after()` call `runGhlJobs` inside try/catch and log with `errorFields(error)` as the submission route does.
- **QA:** the `after()` GHL attempt is tested with Next's `after` replaced (outside a request scope the real one throws); its behaviour in a real Vercel invocation is **unverified** until the preview.
- Lint warnings in `scripts/` are A2's, not changed.

**Could not do:** `supabase/seed.sql` (not in this step's description); `EXPLAIN` of the housekeeping statements (no direct psql here).
**CONTRACT QUESTION:** none blocking. Two soft observations for the architect: (a) `createQuoteRequest` lists only `SubmissionRefused` for 400, but a non-JSON body needs a 400; I answered `bad_request` (a code in the Problem enum) rather than invent anything; consider listing `BadRequest` on that operation. (b) The Problem schema has no `request_id`, so 500 bodies carry it only in the `x-request-id` header.
**BLOCKED:** none.
