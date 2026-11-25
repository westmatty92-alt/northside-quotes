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

## Attempt 2: QA2 fix (2026-11-24)
**Ticket:** BUG-QA2-2 (probe PRB-74b): `POST /api/quote-requests` answered 500 when `name`, `problem` or `address` held an unpaired UTF-16 surrogate.
**Status:** done.

### Root cause (found before changing anything)
The source is none of the first three guesses; it is the call to PostgREST. Shown on staging by calling `start_quote_request` directly and by the route's own log line:
1. `JSON.parse('"Zo\ud800e"')` succeeds. The result is a JS string that is not well-formed Unicode (`isWellFormed()` is false). So JSON parsing does not fail.
2. The generated zod schema only checks length, so it accepts the string. Zod does not fail.
3. supabase-js re-serialises the argument as JSON with the escape `\ud800` and sends it. PostgREST cannot decode a lone surrogate and refuses the whole call with `PGRST102` ("Empty or invalid json"). The request never reaches Postgres, so this is not a Postgres encoding error.
4. `dbProblem()` had no mapping for `PGRST102`, so the default branch answered 500 `internal_error`. The log line showed `error_class: postgrest, code: PGRST102`.
Why only three fields: `email` and `phone` were already refused as 422 by their own shape checks (zod email, 10-digit phone). The NUL check I wrote in attempt 1 covered the same four text fields but did not test for surrogates.

### Reproducing test, then the fix
- Test first: `tests/api/submission/unpaired-surrogates.test.ts` (new, staging-backed, in-process, cleans up its rows). Before the fix: **20 of 36 failed, all with 500 / PGRST102** (name, address, problem on the create path and the update path, plus the combined, single-field and log cases). After the fix: **36 of 36 pass**.
- What it covers: five bad shapes per field (lone high, lone low, high then ordinary character, reversed pair, high at the end) for `name`, `address`, `problem`, `email`, `phone`, sent as raw JSON text with the six-character `\ud800` escape typed out like QA's curl; each is a 422 problem+json naming only that field, and no row is stored. Also: several bad fields named together; a surrogate plus another fault on one field names it once; the 422 body and the log line contain none of the submitted text; an emoji (a valid pair) is still accepted and stored exactly; the update path (same token, changed answers) is a 422 for `name`, `address`, `problem` and the pending request is unchanged; `urgency`, a photo `content_type`, an unknown key and an unknown key's value holding a surrogate are 422, not 500; a honeypot holding one is the generic 400 refusal; the submit route's only string, the request id, is 404. One case documents the root cause by calling the database RPC directly and expecting `PGRST102`.
- Fix: `src/lib/server/services/submissions.ts` only. A `FREE_TEXT_FIELDS` list (`name`, `phone`, `email`, `address`, `problem`) and an `unstorable()` check (NUL, or `!isWellFormed()`) replace the old NUL-only loop in `parseCreateBody`. The result is the same 422 with `errors[] = [{ field, message }]` using the field's own message, one entry per field. It runs before any database call, so create and update (same code path) are both covered. `submitQuoteRequest` takes no body and no free text; its request id is checked against a UUID pattern and is 404 otherwise.
- Not changed, on purpose: `dbProblem()` still maps an unknown PostgREST code, `PGRST102` included, to 500. A 422 there would need a field name the service cannot know; the input check is the right place.

### Commands run (each as `cd <lane> && ...`)
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; 2 existing warnings in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs`, not mine).
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/api/submission tests/api/housekeeping tests/api/health tests/unit/env --passWithNoTests=false` -> **refused** by the permission system. Ran the allowed fallback `npx vitest run tests/api/submission tests/api/housekeeping tests/api/health tests/unit/env --passWithNoTests=false` -> exit 0, 14 files, 221 tests passed (staging-backed; the env came from the main checkout's `.env.local` through `tests/helpers/staging-env.ts`).
- `npm run build` -> exit 0.
- `node scripts/check-code-guards.mjs service-role` -> exit 0 ("OK").

### Changed files
- `src/lib/server/services/submissions.ts`: the fix (above).
- `tests/api/submission/unpaired-surrogates.test.ts`: new, the reproducing test.
- `tests/api/submission/zz-diagnose.test.ts`: **to be deleted**. I created it for the diagnosis and cannot remove files (no rm). It now holds one network-free check so it is a valid test file until you delete it. It is not needed.

### Notes
- `src/lib/server/services/quote-requests.ts` (staff side, BE3's) already has a private `unstorable()` with the same rule; I left it alone and did not share one helper, to keep this diff to a single owned function. A shared helper is a tidy-up for later.
- Other public text routes were not probed by me. QA reports PRB-44 (staff note, search) passes.
- Verified against the staging project only; the hosted PostgREST behaviour (PGRST102) is what the tests exercise. Nothing run against production.
**CONTRACT QUESTION:** none. **BLOCKED:** none. **NEW SETTING:** none.

## Attempt 3: REV-3 and REV-2 backend half (2026-11-25)
**Status:** done. Every verify command exits 0, and the vitest list passed three times back to back (230/230 each). Verification also turned up a third, real defect: `checkPhotos` sometimes read a replaced photo's old bytes from the Storage cache. It is fixed below with its own failing-then-passing test.
**Database:** the shared staging Supabase project (hosted), never production or a local stack. Migrations 0900/1000 were already applied by A2; I applied nothing.
**Read:** this report; `.baseleap/reviews/REV1.md` (REV-2, REV-3, REV-10); `.baseleap/reports/A2.md` "Attempt 3: REV-2" (CQ-1 to CQ-4); migration `20261125001000_photo_plan_replay_fallback.sql`; `src/types/database.ts`; `submissions.ts`, `jobs/housekeeping.ts`, `tests/helpers/staging.ts`, `tests/helpers/api.ts`, `submit.test.ts`, `create.test.ts`, `create-failures.test.ts`, `housekeeping.test.ts`; `src/components/request/photo-upload.ts` (the form's 409 rule, which the test mirrors); storage-js 2.119.2 `download()` (the `cacheNonce` option).

### Assumptions
1. **CQ-2 wording:** a size that differs from the plan gives 422 `photo_invalid` with the existing message "This photo didn't upload. Please add it again.", is recorded as `photo_upload_failed` with reason `storage_error`, and the object is removed. That is the closest existing message and metrics reason, with no new value.
2. **CQ-2 order:** the byte check (type, size cap, dimensions) runs first. The size comparison applies only to a photo that passes it, so a text file renamed `.jpg` is still reported as "must be JPEG, PNG or WebP" (AC-002.4), whatever its size. A row with no `photo_plan` (started before the route sent plans) is not compared, as A2's CQ-2 says.

### Fix 1: REV-3, housekeeping test isolation (test-only; `jobs/housekeeping.ts` unchanged)
- **Failing first:** I added a "bystander" to the old test: a pending request and a rate-limit hit created 26 and 25 hours ago in real time, which is what other runs' fixtures look like, and asserted they survive. Result: **1 failed / 17 passed**, `REV-3: left alone the stale rows another run owns` → `expected false to be true` (this file's own purge deleted the other run's request). That is the REV-3 mechanism, reproduced.
- **Approach (no new production parameter):** the job already takes its cutoff from the clock (`runHousekeeping(nowMs = Date.now())`, cutoff = now − 24 h). The test creates every row the purge may touch in January 2001. Every authorised call runs the **production route and job unchanged**, with only `Date` faked (`vi.useFakeTimers({ toFake: ['Date'], now: 2001-01-03T12:00Z })`). Timers, fetch and TLS keep the real clock. The cutoff is therefore 2001-01-02T12:00Z, which reaches only this file's rows. Nothing real on staging is from that era.
- **What it proves now** (`tests/api/housekeeping/housekeeping.test.ts`, 18 tests, all passing):
  - **Exact counts:** `{ pending_requests_purged: 1, photos_purged: 1, rate_limit_rows_purged: 3, sign_in_rows_purged: 2 }`, not "at least". A second run gives exactly 0 everywhere.
  - **This file's stale rows go:** the pending request and its file, a hit 24 h + 1 min old and one 48 h old, the spam window, the sign-in attempt and the sign-in pause.
  - **This file's rows that must stay, stay:** a hit 24 h − 1 min old (the 24-hour line, both sides), the fresh pending request and its file, an old submitted request, both spam events.
  - **Other runs' rows stay:** bystanders stale in real time (a pending request with its file, a hit, a sign-in attempt and a pause, 25 to 26 hours old) all survive.
  - **Refused calls purge nothing:** they are also made at the faked time, so a refused call that purged would reach this file's rows.
  - **Production behaviour is still proved:** the route takes no time input, so the faked clock is the only difference from production. The job purges stale pending requests with their files, and all four counter tables.
- **Sweep:** `beforeAll` first clears anything older than 2002-01-01, which can only be this file's leftovers from a run cancelled before its afterAll (REV-3's orphan point). Window events are deleted with psql in afterAll.
- **Cleanup:** the old manual sign-in cleanup is replaced by `trackHash` for the email hashes, so the shared afterAll deletes them and proves it.
- **Remaining limit:** two copies of *this file* running at the same moment share the 2001 era and could purge each other's rows. CI now serialises the staging-database jobs (devops). Nothing else on staging is touched by the test any more.

### Fix 2: REV-2 backend half (CQ-1, CQ-2, CQ-3)
- **Failing first** (tests written before any code change):
  - `create-failures.test.ts` "REV-2 CQ-1: passes the validated photo plan … as p_photos, and [] for no photos" → **1 failed / 19 passed**: `p_photos` was missing from the RPC args.
  - `submit.test.ts` → **5 failed / 20 passed**:
    - both swap cases (another size; another type at the same size): `expected ['photo-1'] to deeply equal []`, so X was kept after the resend;
    - the submitted case: `expected 200 to be 409`;
    - CQ-3b: `expected null to deeply equal [plan]`, so no plan was stored;
    - CQ-2: `expected 200 to be 422`, so the wrong size was accepted.
- **Fix** (`src/lib/server/services/submissions.ts`):
  - **CQ-1:** `StartArgs.p_photos`, set to `data.photos.map(({ position, content_type, size_bytes }) => …)`. This is the plan as validated (positions 1..n in order), always sent, `[]` for no photos.
  - **CQ-2:** `completeQuoteRequest` also selects `photo_plan`. `plannedSizes()` reads it, or gives null for a row without one. `checkPhotos` refuses a photo that passes the byte check but whose size differs from its planned `size_bytes`. Only the size is compared.
- **After:** `create-failures` **20/20**, `submit` **25/25** on that run. The tests:
  - **CQ-3a:** "pending: X uploaded, then the same token and photo count with Y (another size | another type at the same size) clears X, and Y is what gets stored". The resend is 200 with the same id, and the folder is empty after it. Y is uploaded the way the form does it (a 409 counts as uploaded). The stored row, the stored bytes and `photo_plan` all equal Y.
  - "submitted: the same token with a different photo plan is a 409 form_already_used, and the stored photo is unchanged". The unchanged resend is still 200 with the reference.
  - **CQ-3b:** "an unchanged resend after photo 1 went up through the real Storage API keeps it". The plan is stored on create. The object's `created_at` (from the Storage listing) is ≥ `photos_planned_at`. The resend is 200, `photo-1` is still there, and `photos_planned_at` is unchanged. Photo 2 then completes the request with 2 photos. **This confirms on hosted staging that Storage stamps uploads with the database clock**, A2's open assumption.
  - **CQ-2:** "plan 600 bytes, stored 700: 422 photo_invalid on photos[1], removed, recorded (`storage_error`), and the right photo then completes it"; "only the size is compared: a declared type that differs from the bytes is stored with the type the bytes say"; "a request stored without a plan … the photo count decides, as before".
- **Fixture correction (disclosed):** `submit.test.ts` "stores a JPEG, a PNG and a WebP…" planned 600 bytes for files of 800/900/1000 bytes. It now plans their real sizes, as the form does (`size_bytes = File.size`). The assertions are unchanged.

### Fix 3 (found while verifying): stale photo bytes from the Storage cache
- **Symptom:** in the first full verify run, `AC-002.4` failed at the retry: 422 where 200 was expected. Alone it passed. With the problem body added to that assertion's failure message, a later run showed `photo_invalid` / "Photos must be JPEG, PNG or WebP" for a good JPEG. The CQ-2 retry failed the same way in the same run.
- **Cause:** after a refused photo is removed and a new one is uploaded at the same path, `bucket.download(path)` sometimes returned the **removed** object's bytes, cached under the same URL. `checkPhotos` then refused the good photo and **deleted** it. This is a homeowner-facing bug in the AC-002.4 → AC-002.6 flow ("add it again" straight after a refusal), not just a test flake. It may also explain BE1's earlier one-off failed verify, alongside REV-3. Not proven: I have no log of that run.
- **Failing first:** new test `submit.test.ts` "a refused photo replaced at the same path straight away is checked by its NEW bytes …, 10 times over". It runs ten independent refuse → replace → submit cycles at once.
  - With the old call put back temporarily: one run had 2 of 10 cycles answer `422 photo_invalid "Photos must be JPEG, PNG or WebP"`, the next run passed. A 5-cycle version failed 1 run in 3. It is intermittent by nature.
  - With the fix: 4 of 4 runs passed (40 cycles), then the three full stability runs below.
- **Fix:** `checkPhotos` downloads with `{ cacheNonce: <the listed object's id> }` and `{ cache: 'no-store' }`. The object id comes from the listing, which is a consistent database read and new on every upload. The same object can still be served from cache, and a replaced object always gets a new URL. The test's own `storedBytes` helper also uses a nonce.
- **Test-harness change (disclosed):** in one run the test's own 5 MB stand-in browser upload failed with `StorageUnknownError: fetch failed`. storage-js raises that only when no HTTP response arrived (a transport failure, as in QA's BUG-QA1-6). The `upload` helper in `submit.test.ts` now retries once on that error only, logs `upload transport failure …; retrying once`, and on the retry counts a 409 as success (it can only mean the first attempt landed). It never retries an answer from Storage. It did not fire in any of the three stability runs.

### Commands run (each as `cd <lane> && …`)
| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 errors, the same 2 existing warnings (`scripts/lib/yaml-lite.mjs:136`, `scripts/sync-agent-permissions.mjs:36`, not mine) |
| `node --env-file-if-exists=.env.local node_modules/.bin/vitest run …` | **refused** by the permission system (approval prompt), as in attempts 1 and 2. I used the sanctioned `npx vitest run …` equivalent |
| `npx vitest run tests/api/submission tests/api/housekeeping tests/api/health tests/unit/env --passWithNoTests=false` | **stability run 1:** exit 0, 13 files, **230 passed** (38.5 s) · **run 2:** exit 0, 13 files, **230 passed** (43.2 s) · **run 3:** exit 0, 13 files, **230 passed** (38.4 s). Back to back, after the final code. The transport retry never fired |
| `npm run build` | exit 0 (all API routes dynamic) |
| `node scripts/check-code-guards.mjs service-role` | exit 0, `check-code-guards service-role: OK` |

Earlier runs in this attempt (before the final code), disclosed: three full runs failed, one test each time (AC-002.4 retry; AC-002.3 upload `fetch failed`; AC-002.4 retry plus the CQ-2 retry). These are the Fix 3 defect and the transport error above. Single-file runs were used for every failing-first and passing step, as the brief asks.

### Changed files
- `src/lib/server/services/submissions.ts`: CQ-1 (`p_photos`), CQ-2 (`photo_plan` select, `plannedSizes`, size check in `checkPhotos`), Fix 3 (download `cacheNonce` from the listed object id, `cache: 'no-store'`)
- `tests/api/housekeeping/housekeeping.test.ts`: rewritten for REV-3 (2001 era, faked `Date` on authorised calls, exact counts, boundary rows, bystanders, sweep)
- `tests/api/submission/submit.test.ts`:
  - new: the REV-2 tests (CQ-3a both swaps, submitted 409, CQ-3b), the CQ-2 tests, the 10-cycle stale-read test; helpers `storedBytes`, `uploadLikeTheForm`, `resend`
  - fixture sizes corrected in the JPEG/PNG/WebP test
  - the AC-002.4 retry assertion now prints the problem body when it fails
  - the transport-only upload retry
- `tests/api/submission/create-failures.test.ts`: the CQ-1 args test
- `.baseleap/reports/BE1.md`: this section
- Not changed: `jobs/housekeeping.ts`, routes, migrations, openapi, generated code, `seed.sql`, helpers.
- **Temporary files:** none created. (Attempt 2's `zz-diagnose.test.ts` is no longer in the lane.)

### Not done / unverified
- REV-2's same-type, same-size swap (A2's CQ-4) is a frontend change (`photo-upload.ts` 409 handling). The database cannot tell two files of equal type and size apart. CQ-2 does not cover it either.
- REV-10 (ranged read instead of a full download) and REV-13 were not in this brief, so I didn't touch them.
- Other suites (`tests/api/inbox/**`, `tests/integrations/**`) were not run. They don't go through `completeQuoteRequest` with photos (checked by grep). The inbox ones import only the list route's GET, which is unchanged.
- The Smart CDN behaviour behind Fix 3 is inferred from the symptom (old bytes after a remove and re-upload) plus storage-js's documented `cacheNonce`. I did not read the Storage server's cache headers.

**CONTRACT QUESTION:** none. Everything fit the existing contract, migrations and generated types (`p_photos?: Json` was already generated).
**BLOCKED:** none. **NEW SETTING:** none.
**Notes for the next step:**
- Frontend: route A2's CQ-4.
- Architect: the doc follow-ups A2 listed (`SECURITY_MODEL.md:66`, `architecture.md` Submissions) still apply. Consider noting the cache-nonce rule for any server-side read of an object that can be replaced at the same path.
- QA: BUG-QA1-6 transport failures were seen once from this machine to hosted Storage.
