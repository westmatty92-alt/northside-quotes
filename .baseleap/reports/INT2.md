# STEP INT2 — GHL routes for Northside quote requests (ghl-sync cron route, retryGhlCopy)

## Attempt 1 — 2026-11-23
**Status:** done
**Lane:** /home/admin/baseleap/rehearsal/northside-quotes-wt-backend (synced from staging 470c0d4). No git, no rm. Every command was run as one compound `cd <lane> && …`.

**Read:** docs/openapi.yaml (runGhlSyncJobs, retryGhlCopy, GhlCopyRetryResult, JobRunResult, SyncCopyState), docs/integration-contract.md, docs/SECURITY_MODEL.md (invariants 11 and 12), src/lib/server/env.ts, http.ts, log.ts, auth/require-staff.ts, integrations/ghl/{index,runner,process-job,client,log}.ts, services/quote-requests.ts (mapGhlState), supabase/migrations/20261120000400_ghl_sync.sql and 20261120000600_functions.sql (request_ghl_copy_retry, claim_ghl_job, finish_ghl_job), the housekeeping route and its test (the pattern), tests/helpers/*, tests/integrations/ghl/*, tests/integrations/staging-env.ts, tests/mocks/ghl/simulator.mjs, vercel.json (the four cron entries are already there).

## Files changed (all new; nothing outside the owned paths)
- `src/app/api/jobs/ghl-sync/route.ts`: GET runGhlSyncJobs. `isCronRequest` first (401 problem+json), then `runGhlJobs()` with no arguments (no requestId, the runner's own 300 s budget with the 60 s reserve), answers exactly claimed/succeeded/waiting/failed. A database failure is a 500 with `{ error_class, code }` logged. `maxDuration = 300`. POST/PUT/PATCH/DELETE are 405 with `Allow: GET`.
- `src/app/api/quote-requests/[request_id]/ghl-copy-retries/route.ts`: POST retryGhlCopy. `await requireStaff(req)`, then a non-uuid id is 404, then `request_ghl_copy_retry` under the staff member's own session (RLS), then `runGhlJobsWith({ jobId, limit: 1 })`, then the copy state is read back and mapped with the request detail's own `mapGhlState`. `maxDuration = 60`. 405 for the other methods with `Allow: POST`.
- `tests/integrations/routes/ghl-sync.test.ts`: 28 tests, offline.
- `tests/integrations/routes/ghl-copy-retries.test.ts`: 27 tests, offline (guard, database client and runner scripted).
- `tests/integrations/routes/db.test.ts`: 27 tests against the staging database, a real staff session and the GHL simulator. The file is named `db.test.ts` so `npm run test:offline` excludes it, like INT1's.

## How the retry works (decisions worth reviewing)
- **PT409 means two things in this codebase.** `dbProblem()` maps it to 409 `stale_version`. For this route the database raises PT409 for "no offers consent" and "the copy is not failed" (which includes "an attempt is already running"), so the route maps it to 409 `not_retryable`. Every refusal happens inside `request_ghl_copy_retry`, before the runner exists, so a refused retry cannot make a GHL call. A test proves the runner and the database read are never reached on PT409.
- **The contract lists 401, 404, 409 and 500 only**, so a 503 (database unreachable) or 422 from the database becomes a 500 with no detail, as `staffDbProblem` does for the other staff routes.
- **`limit: 1` in addition to `jobId`.** The runner loops until the claim returns null; `limit: 1` makes "this call settles the one job it re-armed and nothing else" explicit rather than relying on the job not being due again.
- **`retried`.** Taken to mean "this call ran an attempt": `claimed > 0`. It is false only when a cron run claims the re-armed job in the instant between the re-arm and our claim. The answer is then 200 with the copy state as it is now (waiting). See CONTRACT QUESTION.
- **Database failure after the re-arm** (e.g. the claim fails): the route answers 500, the job stays `waiting` and due, and the next cron run attempts it. Nothing is lost.
- **Never a second contact:** the retry runs the same `processJob` as every copy (our database match, then GHL duplicate search, then create). Two tests prove it on staging.

## Acceptance criteria → test map
Test files: `S` = ghl-sync.test.ts, `R` = ghl-copy-retries.test.ts, `D` = db.test.ts (staging DB).

| Criterion | Test (describe > it) |
|---|---|
| Invariant 12 / S0 SEC-4: `Bearer undefined`, `Bearer `, no header, wrong secret (same and other length, one char short, one char over), no scheme, lower-case scheme, double space → 401, runner not called, secret not in body or log | S: "invariant 12 / S0 SEC-4 …" it.each of 11 cases |
| Secret unset, empty or 31 chars → every call incl. a matching header is 401 | S: "with CRON_SECRET unset / empty / 31 characters …" (3 cases); "a 32-character secret is enough" |
| Calls `runGhlJobs` with no requestId inside the 300 s budget | S: "runs every due job (no request id) …" (`toHaveBeenCalledWith()`); "is configured for the 300-second function cap …" (`maxDuration` 300, RUN_BUDGET_MS 300000, RUN_RESERVE_MS 60000) |
| Contract shape (JobRunResult, four keys, extras never exposed) | S: "runs every due job …", "an idle run is a 200 with four zeros" |
| "Stops claiming when less than 60 s of 300 s is left" through the route | S: "stops claiming when less than 60 s …" (55 s left, 1 claimed, 2 still due); "keeps claiming while at least 60 s are left" |
| "Idempotent: twice in a row, or at the same time, runs nothing twice" | S: "runs the due jobs … a second call in a row runs nothing twice"; "two calls at the same moment run each job once between them" |
| A GHL outage never fails the route; counts only | S: "a GHL outage is counted as waiting and is still a 200"; "a refused value (422) is counted as failed"; "no GHL token configured: failed at once as config_missing, no GHL call" |
| Invariant 11: 500 with no detail, log `{ error_class, code }` only | S: "GhlStoreError -> 500 …" (exact log key list); "any other thrown value is a 500 whose message … is never answered or logged" |
| 405 for other methods on both routes | S: "any other method is a 405 …"; R: "any other method is a 405 …"; D: "any other method is a 405 problem with Allow: POST" |
| AC-014.1 / AC-014.2: failed copy retried at once; copied, or failed with retried true | R: "copied: 200 …", "failed again: 200 …"; D: "the attempt works: 200 copied, retried true …", "the attempt fails again (GHL 5xx) …" (plus the retry after that), it.each revoked 401 / forbidden 403 / unprocessable 422, "no GHL token configured: failed as config_missing … no GHL call" |
| The answer equals what the request detail shows | D: "the answer is the copy state the request detail shows afterwards" |
| AC-014.3: copy not failed (pending, waiting, succeeded) → 409, nothing changes, no GHL call | D: it.each 3 states |
| AC-014.3: second call while an attempt runs → 409, sends nothing | D: "a second call while the first attempt is still running is 409 …" (simulator `slow` mode, second call made once the first is inside GHL); D: "two calls at the same moment: one runs the attempt, the other is 409" |
| AC-014.4: unticked request → 409 not_retryable, no GHL call, no job created | R: "PT409 … the runner never runs"; D: "409 not_retryable, no GHL call, no job created, no contact linked"; D: "the same refusal for every attempt, and the database still refuses to queue a job" |
| AC-009.4 / match rule: a retry never creates a second contact | D: "a contact for this homeowner already exists in GHL … links it" (zero `POST /contacts`); D: "another consented request of the same homeowner is already linked … no search and no create" |
| 401 for every non-staff call (no header, garbage token, oversized token, user without a staff row, cookie only) before any database or GHL work | R: "no valid staff session -> 401 …", "PT401 …"; D: 3 it.each cases, "a signed-in user who is not staff", "cookies are not a credential" |
| 404 for unknown, non-uuid or still-pending request | R: "PT404 …", 5 non-uuid ids; D: "an unknown id", "an id that is not a uuid", "a request that is still pending" |
| Contract's 401/404/409/500 only: 503 and 422 become 500 | R: it.each 5 database codes ('' , 08006, 53300, PT422, 42501) |
| `runGhlJobsWith` called with exactly `{ jobId, limit: 1 }` | R: "copied: 200 …" (`toHaveBeenCalledExactlyOnceWith`) |
| Errors as problem+json through http.ts; log only `{ error_class, code }`; no token, name, phone, email, address, database text | R: "GhlStoreError …" (exact key list, message never logged), "any other error …", "failing to read the copy state back", "a successful retry logs no token …", "the answer carries nothing of the request"; D: "a full retry … holds no token, no name, phone, email or address" |

**Mutation check (my own tests, reverted afterwards):** I removed the cron gate and the PT409 mapping in turn; 16 tests failed (all the 401 cases, the unset-secret cases and the PT409 case). Both edits were restored and the suites re-run green.

## Commands run (all in the lane, all with the `cd` prefix)
- `npm run typecheck` → exit 0 (the first run failed on two typing slips in my test; fixed, re-run clean).
- `npm run lint` → exit 0, 0 errors; 2 pre-existing warnings in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs` (not my files).
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/integrations/routes --passWithNoTests=false` → **refused by the permission system** ("requires approval"); used the fallback `npx vitest run tests/integrations/routes --passWithNoTests=false` → exit 0, **Test Files 3 passed (3), Tests 82 passed (82), skipped 0** (S 28, R 27, D 27). Run three times (after the mutation revert too); the verbose run lists no skipped or failed test. D ran against the staging database (its first test asserts the env is present and not production).
- `npm run build` → exit 0; `/api/jobs/ghl-sync` and `/api/quote-requests/[request_id]/ghl-copy-retries` are in the route table.
- `node scripts/check-code-guards.mjs service-role` → `check-code-guards service-role: OK`. Neither route imports the admin client; only runner.ts does (through the existing allow-list).
- `npx vitest run tests/integrations/ghl --passWithNoTests=false` (INT1 re-check after the merge) → exit 0, **Test Files 5 passed (5), Tests 99 passed (99), skipped 0**.
- `npm run test:offline` → exit 0, 26 files, 527 tests passed (my two offline files need no database; `db.test.ts` is excluded as intended).

## Staging data hygiene
`db.test.ts` tracks every request it makes, deletes them in `afterAll` (jobs and events cascade), then counts `quote_requests`, `ghl_sync_jobs` and `events` for those ids and fails if any is left; `setupStaging` removes its Auth users and proves it. The suite passed, so the proof held. Seeded pending/waiting jobs have `next_attempt_at` a day ahead so no other runner can claim them. Env is loaded through `tests/integrations/staging-env.ts` (URL, service-role key, INT1's guards); the staff session and cleanup also need `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_STAGING_DB_URL` (psql), which `tests/helpers/staging-env.ts` loads from the same `.env.local` files. A missing variable fails every test; nothing skips.

## Deliberately not tested against the staging database
`GET /api/jobs/ghl-sync` with the real runner on the shared staging database. The route claims every due job, so it would take jobs from other test files running in parallel workers and fail them as `config_missing` (the GHL token and location are unset). The real runner is exercised behind the real route on an in-memory store and the simulator instead, and INT1's `db.test.ts` already covers the real claim and settle functions.

## Could not do
- The `node --env-file-if-exists=… node_modules/.bin/vitest` form of the verify command: refused here, so the `npx` fallback the brief allows was used. The ledger should run its own form.
- No live GHL call, as instructed (and none is possible: `GHL_LOCATION_ID` and the token are unset).

## CONTRACT QUESTION (non-blocking, the build went ahead on the reading below)
- **What does `retried` mean in `GhlCopyRetryResult`?** I need: the meaning of `retried: false`. Why: the contract says "failed with retried true" and its example shows `retried: true` for copied, but never says when it is false. Artifact: docs/openapi.yaml, `GhlCopyRetryResult` and the `retryGhlCopy` description. What I built: `retried = (this call ran an attempt)`. It is false only when a cron run takes the just re-armed job before this call can claim it (200, copy state "waiting"). Alternative if the architect prefers: answer 409 not_retryable in that case ("an attempt is already running"), which matches the description's wording for a concurrent attempt. Suggested change: one sentence in the operation description naming the `retried: false` case. The frontend only needs to show "The retry did not work" for `failed` + `retried: true`, which is unaffected either way.

## TO CONFIRM (for devops / the ledger; I could not verify these here)
- `export const maxDuration = 300` (cron route) and `60` (retry route). The contract's 300 s budget assumes Vercel's 300 s function cap, which on the Hobby plan needs Fluid Compute. Devops should confirm the project setting before the first deploy; if the plan cannot do 300 s, the runner's `RUN_BUDGET_MS` and this export must change together.
- Staging has no GHL token or location id, so on staging a retry ends as `failed` with class `config_missing` and a cron call fails every due job the same way. That is the specified behaviour (AC-009.3), not a defect; QA should expect it until Matthew sets `GHL_PRIVATE_INTEGRATION_TOKEN` and `GHL_LOCATION_ID` for the test sub-account.

## Handoffs
- **DevOps:** the four cron entries for `/api/jobs/ghl-sync` are already in `vercel.json` (00:00, 06:00, 12:00, 18:00 UTC). Env var names used: `CRON_SECRET` (the route), `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_API_BASE_URL` (all read only inside `src/lib/server/integrations/ghl/client.ts`, unchanged). This step adds no new alert wiring; the signals the I15 alert would use are the `ghl_sync_gave_up` and `ghl_sync_attempt_failed` events and `failed` jobs (unverified which of them the architecture names for the alert).
- **CRM Automation:** nothing new in this step (the platform setup list in docs/integration-contract.md still stands).

## Notes for the next step
- QA can call the cron route by hand on staging with `Authorization: Bearer <CRON_SECRET>`, and the retry with a staff bearer token; both return problem+json on every refusal.
- Frontend: the retry answer is `{ copy: { state, at }, retried }`; a 409 `not_retryable` means "not failed any more, no consent, or an attempt is already running". Refresh the request detail on any 409.
