# STEP INT1 — GHL core: typed client, contact copy by match rule, stage tags, job runner + seam, offline GHL simulator
## Attempt 1 — 2026-11-20
**Status:** partial. Everything is built and the offline half is proven. **The 12 staging-database tests in `db.test.ts` were written and desk-checked but never executed by me**: the `node --env-file-if-exists=.env.local …` form was refused in this session ("requires approval"), and under the `npx vitest run` fallback `.env.local` is not loaded, so that suite skips. The ledger's own verify run (node form, `.env.local` inherited) is the first time they will run. Treat them as unproven until it passes.

**Providers touched:** GoHighLevel (HighLevel API v2), test sub-account only. **No live call was made, and none was possible** (`GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID` unset).
**What flows which way:** out only, consented requests only (contract). Contact (name, firstName, lastName, phone `+1…`, email, address1) and tags `quote-request` + one stage tag. Nothing read back; no webhook route (contract: none in v1).

**Files changed (all new unless noted)**
- `src/lib/server/integrations/ghl/client.ts` — typed client, the only reader of `GHL_PRIVATE_INTEGRATION_TOKEN`; 4 calls only; 10 s timeout; six error classes; production base URL lock; id/tag/redirect guards
- `src/lib/server/integrations/ghl/mapping.ts` — field mapping, tag names, name split, E.164, contact-id pattern
- `src/lib/server/integrations/ghl/process-job.ts` — match rule, create/link, 400-on-create repeat search, stage tags, wait/abandon
- `src/lib/server/integrations/ghl/runner.ts` — claim one / process / settle with that lease loop, 60 s reserve, admin store (the one service-role importer)
- `src/lib/server/integrations/ghl/log.ts` — allow-listed one-line JSON log (BE1's shared `log.ts` does not exist yet)
- `src/lib/server/integrations/ghl/index.ts` — EDITED: A2 no-op replaced by the real `runGhlJobs`, same signature
- `tests/mocks/ghl/simulator.mjs`, `simulator.d.mts`, `fixtures/*` — the offline simulator QA reuses
- `tests/integrations/ghl/` (`helpers.ts` plus `mapping`, `client`, `copy-and-tags`, `runner`, `db` test files) — 98 tests
- `docs/integrations/README.md`, `docs/integrations/ghl.md` — registry, profile, runbook, simulator guide, unverified-live list
- Not touched: routes, `src/lib/server/jobs/ghl-sync.ts`, vitest/eslint/package config, migrations, devops files.

**Commands run (in this tree, on main)**
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0 (0 errors; 2 warnings in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs`, not my files)
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/integrations/ghl --passWithNoTests=false` → **refused by the session (requires approval); not run**
- `npx vitest run tests/integrations/ghl --passWithNoTests=false` → exit 0: **5 files, 86 passed, 12 skipped** (the 12 are `db.test.ts`, skipped for lack of the env)
- `npm run build` → exit 0
- `node scripts/check-code-guards.mjs service-role` → exit 0 ("OK")
- Mutation check on the offline tests (each reverted afterwards, `git diff` confirmed): disabling lost-lease detection fails 1 test; disabling the repeat search after a 400 fails 2; removing the consent guard fails 2.

**Acceptance criteria → test** (file · test). "DB" = in `db.test.ts`, unexecuted by me.
- Consent: an unticked request never causes a call (ruling 1B, AC-009.9, AC-017.16) → `copy-and-tags` "consent: an unticked request never causes a call" (3 tests, zero sim calls, settle `abandon`); DB "an unticked request: no job exists… the database refuses to queue one" (trigger 23514 for both kinds, zero calls through the runner).
- Unticked never matched or linked (AC-009.12, AC-009.13, AC-017.17) → DB "an unticked request with the same email is never matched, linked or sent…" (match RPC null, column check 23514, contact keeps the ticked request's stage).
- Create with fields + `quote-request` + current stage tag (AC-009.1, AC-017.3, AC-017.7) → `copy-and-tags` "searches, then creates with the mapped fields…"; `client` "sends only the mapped contact fields"; `mapping` "the create body carries the mapped fields and tags and nothing else".
- Match rule: database first, then GHL search, then create → `copy-and-tags` "our own database match", "GHL duplicate search found it"; DB "a second ticked request with the same email…" and "the same phone with another email links the same way" (AC-009.10, AC-009.11).
- Linking changes tags only, never contact fields (AC-009.5, AC-017.14) → `copy-and-tags` "our own database match…" (contact fields as the owner left them, owner's `vip` tag kept); DB second-request test (contact still carries first request's fields).
- Lost reply gives one contact (AC-009.4) → `copy-and-tags` "a create that timed out but was applied…"; DB "a timeout (lost reply)…".
- 400 on create → repeat search once, link or `rejected` (contract) → `copy-and-tags` "GHL answers 400 to the create" (3 tests); 400 on tag call and 404 never recreate.
- One stage tag at a time, `quote-request` kept, only the other three removed (AC-017.8) → `copy-and-tags` "stage tags"; `client` "only quote-request and the four stage tags can be added…", "removing stage tags keeps quote-request and the owner's own tags"; `mapping` tag-set test.
- Last change wins in any run order (AC-017.15) → DB "last change wins on a shared contact, whatever order the jobs run in" (ends `quote-lost`, then `quote-won` after a newer change; owner tag kept); `copy-and-tags` "every attempt re-reads the stage".
- Stage tag waits for its copy, abandoned if the copy failed (FR-24) → `copy-and-tags` "stage tags" (2 tests); DB "a stage-tag job waits for its contact copy…".
- SEC-7 lease: finish gets that claim's lease; a lost or superseded lease is ignored → `runner` "leases (S0 SEC-7)" (4 tests); DB "lease semantics the runner relies on" and "a job superseded by a newer status change drops its lease" (these pin the database behaviour the runner's `lease_lost` detection depends on).
- Stop with under 60 s of 300 s left → `runner` "time budget" (3 tests, exact boundary 60 s vs 59.999 s, fake clock). `limit` and bad ids → "limit and scope".
- SEC-12 contact id validated and `encodeURIComponent`-ed → `client` "contact id … never reaches the network" (8 bad ids), "a valid id goes into the path as is"; `copy-and-tags` "a contact id from our database that is not URL-safe…"; reply id check in `client` contract tests. Note: the pattern admits no character `encodeURIComponent` would change, so the encoding is belt and braces and cannot be shown to do work.
- SEC-20 production ignores `GHL_API_BASE_URL` → `client` "base URL (S0 SEC-20)" (4 tests incl. fail-closed on a bad override).
- Token missing (AC-009.3, AC-017.10) → `client` "configuration" (5 cases, zero calls), `runner` "no token configured…", DB seam test (job failed `config_missing`, event, token absent from the event).
- Outage table (timeout, 5xx, 429, 401, 403, 400, 404, 422, drift) → `client` "errors map to the six metrics-spec classes", `runner` "outage behaviour" (8 cases), DB "a 5xx schedules the retry (exactly 5 minutes)… a 422 fails at once".
- Contract/drift: fixtures parsed verbatim; a renamed `id` fails naming `contact.id` → `client` "contract: replies are parsed…" (3 tests).
- Redaction: no token, name, phone, email, address, contact id or URL in logs or errors → `runner` "redaction" (2 tests, real `logGhl`, all console and stream output captured), `client` "the error carries no token, no URL, no body…", "an unexpected exception…" (a thrown error's text never reaches the log).
- The seam keeps its signature and works end to end → DB "the seam runGhlJobs()…" (unexecuted); type-level: `npm run typecheck`, and the BE lane's calls compile unchanged.

**Env var names (sandbox → production):** `GHL_PRIVATE_INTEGRATION_TOKEN` (Sensitive, Preview + Production, both the one test sub-account token for the rehearsal), `GHL_LOCATION_ID`, `GHL_API_BASE_URL` (local/preview simulator only; leave unset in Production, it is ignored there anyway), `VERCEL_ENV` (system). DB tests also read `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (names only; I never opened `.env.local`).
**Cron entries:** none added by me. INT2 builds `/api/jobs/ghl-sync`; DevOps owns the four entries in `vercel.json` (`0 0`, `0 6`, `0 12`, `0 18` UTC).
**Simulator modes covered:** ok, slow, lost_reply, 429, 500, revoked, forbidden, badrequest, notfound, unprocessable, drift; settings allowDuplicateContact (off) and searchLag.

**Unverified (live)** (full list of 14 with consequences in `docs/integrations/ghl.md`)
1. Duplicate search finds the contact after GHL refuses a duplicate create with a 400 (the whole 400 rule rests on it).
2. Tag auto-creation by the add-tags call (OQ-15).
3. `Version: v3` header (one constant, `GHL_API_VERSION`).
4. What the duplicate search returns on a miss beyond `contact: null` (a 404 would be treated as `rejected`), and which field wins when email and phone point at two contacts.
5. Duplicate search right after a create; `firstName`/`lastName` beside `name`; `DELETE …/tags` with a JSON body through Node fetch; statuses for a deleted contact and a refused value; tag endpoint reply bodies (only a 2xx is required); 429 without `Retry-After`; phone/email normalisation; `contacts.readonly` sufficing for the search; latency against 10 s; "Allow Duplicate Contact" off in the sub-account.
All simulator error bodies and statuses for undocumented situations are invented (`tests/mocks/ghl/fixtures/README.md`). The simulator proves our logic, not GHL's behaviour.

**Could not do:**
- Execute `db.test.ts` (see Status). It needs the env loaded by the node form.
- Anything live (no token).
- `src/lib/server/jobs/ghl-sync.ts` and the two route handlers: INT2, per the brief.

**CONTRACT QUESTION:** none. Notes the architect may want, none blocking:
- `package.json` `test:offline` runs `tests/integrations/` as "needs no database", but `db.test.ts` lives there and needs staging. It skips without the env (visible as "12 skipped"), or fails with `REQUIRE_DB_TESTS=1`. If CI should be strict, either set that variable in the CI job that has staging secrets, or move DB-touching integration tests under a folder CI treats as DB-backed.
- `finish_ghl_job(... 'abandon')` is documented for a stage tag whose copy failed; the runner also uses it for the defensive no-consent / vanished-request guard on either job kind. The function body allows that (state `failed`, no event, no attempt counted), but the doc comment does not say so.

**BLOCKED:** `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID` for any live check (Matthew, later, behind approval).

**Notes for the next step**
- **INT2:** `runGhlJobsWith({ requestId?, jobId?, limit? }, deps?)` in `runner.ts` also takes `jobId` for the manual retry (`claim_ghl_job(p_job_id => …)`); the seam `runGhlJobs` deliberately does not expose it. `request_ghl_copy_retry` re-arms the job as `waiting` with `next_attempt_at = now()`, so it is claimable at once. The cron route needs `maxDuration = 300`; the runner assumes a 300 s function (`RUN_BUDGET_MS`).
- **BE1:** `runGhlJobs` throws `GhlStoreError` (operation + SQLSTATE only) when the database fails; wrap the `after()` call. GHL failures never throw. Until BE1's `src/lib/server/log.ts` exists the runner uses its own allow-listed `ghl/log.ts` (same fields); swapping is one import in `runner.ts`. Calling `runGhlJobs()` on staging with no token set will settle every due consented job as `config_missing` (failed at once, per the contract), so do not run it unscoped on staging before Matthew sets the token unless that is intended.
- **QA:** reuse `tests/mocks/ghl/simulator.mjs` (how-to in `docs/integrations/ghl.md`). The `x-sim-mode` header, `/__sim/*` control routes and `queueModes` give failure drills with no network. Fixtures are not recordings.
- **DevOps:** alert on `ghl_sync_jobs` in `failed`; keep `GHL_API_BASE_URL` unset in Production.
- **CRM Automation:** Private Integration with exactly `contacts.readonly` + `contacts.write` on the test sub-account; "Allow Duplicate Contact" off; create the five tags by hand only if the first live test shows adds do not create them.
- Deviations from the generic int skills, all by the contract: no client-level retry or breaker table (retries are the jobs table; lease sized for single attempts), token in env not Vault (PRD), no inbound webhook.

## Pass 2 — 2026-11-20
**Status:** blocked. The silent skip is fixed: the 12 DB tests (now 13 with a config check) can no longer skip, they fail when the staging variables are missing. **They have still not run against staging, because the staging REST credentials are not in `.env.local`.** The step will not go green until Matthew adds them.

**Why they skipped (exact).** `db.test.ts` skipped itself (`describe.skip`) unless `process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY` were both truthy. It needs exactly those two because the runner's store and the tests' seed/cleanup go through `getAdminClient()` (`src/lib/server/admin.ts`, supabase-js over REST). Those two names are **not defined in `.env.local`**. The new helper reports, by name and set/EMPTY state only, what the file does define: `BASELEAP_LEDGER_ANON_KEY`, `BASELEAP_LEDGER_SERVICE_KEY`, `BASELEAP_LEDGER_URL`, `BASELEAP_OPERATOR_EMAIL`, `BASELEAP_OPERATOR_ID`, `QA_HELPER_EMAIL`, `QA_HELPER_PASSWORD`, `QA_OWNER_EMAIL`, `QA_OWNER_PASSWORD`, `SUPABASE_STAGING_DB_URL`. So of the four names the brief listed, only `SUPABASE_STAGING_DB_URL` exists; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` do not (this checkout is itself the main checkout: `git rev-parse --git-common-dir` gives `.git`, so there is no other `.env.local` to find). The ledger's skip was therefore correct behaviour for its environment, not a name mismatch or a loader problem. (I could not look at the ledger's own process env; this is the file the brief says it loads, and my shell did not have the variables either.)

**Why I did not make them run another way.** `SUPABASE_STAGING_DB_URL` is a Postgres connection string. It cannot stand in for the REST client the runner uses, and the service-role key cannot be derived from it. Fetching a key through some other route would be improvising around an access boundary, so I stopped.

**Files changed**
- `tests/integrations/staging-env.ts` — NEW helper. Variables come from the process, else from `.env.local` (this checkout, then the main checkout via `git rev-parse --git-common-dir`) with `process.loadEnvFile()`; never overwrites an existing value, treats an empty value as missing, and removes every key the file adds except the four allow-listed names (so a file cannot leak other settings into a worker). Still missing: returns the names, and the failure message lists them plus a per-file "defines" list. Guards: fails if the URL names `SUPABASE_PROD_PROJECT_REF`, or does not name `SUPABASE_STAGING_REF` when that is set (same names `supabase/scripts/db.mjs` reads; the tests create and delete rows). Values are never printed or returned.
- `tests/integrations/staging-env.test.ts` — NEW, 9 offline tests of the helper (fake values, a temp file, no network).
- `tests/integrations/ghl/db.test.ts` — removed `describe.skip` and `REQUIRE_DB_TESTS`; loads the env through the helper; a standalone test "the staging database is configured and is not production"; a `beforeEach` that throws the env problem so each of the 12 tests fails on its own (a throwing `beforeAll` made vitest count them as skipped: I saw "13 tests | 1 failed | 12 skipped" and changed it); `afterAll` now asserts the delete worked and that no `quote_requests`, `ghl_sync_jobs` or `events` rows remain for the ids the run created. Test logic unchanged.

**Commands run (this tree, main; local files only, no database reached)**
- `npx vitest run tests/integrations/ghl --passWithNoTests=false` → exit 1: **Test Files 1 failed | 4 passed (5); Tests 13 failed | 86 passed (99); skipped 0**. All 13 failures are `db.test.ts`, with the message naming `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `npx vitest run tests/integrations --passWithNoTests=false` → exit 1: **Test Files 1 failed | 5 passed (6); Tests 13 failed | 95 passed (108); skipped 0**.
- `npx tsc --noEmit` → exit 0. `npm run lint` → exit 0 (0 errors; the same 2 warnings in `scripts/`, not my files).
- A `node -e` probe of which names my own shell sees was refused ("requires approval"); not retried in another form.

**Target not met:** "0 skipped, all passing against staging" — skipped is 0, but the 13 DB tests fail for the missing variables, so none of the lease, consent-trigger or contact-match evidence exists yet. Unverified: the 12 tests' own logic against staging, and the new `afterAll` cleanup count (neither has run).

**BLOCKED (Matthew):** the staging project's REST credentials in `.env.local`, by name: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (staging only; optionally `SUPABASE_STAGING_REF` and `SUPABASE_PROD_PROJECT_REF` to turn the guards on). `.env.example` also documents `SUPABASE_STAGING_URL` and `SUPABASE_STAGING_SERVICE_ROLE_KEY` as "staging keys, for the tests"; if those are what Matthew will add instead, say so and I will make the helper map them (a few lines, in a file I own). Once set, re-run `npx vitest run tests/integrations/ghl --passWithNoTests=false`; nothing else changes.

**CONTRACT QUESTION / for the architect (package.json and vitest config are not mine):** the strict behaviour has a side effect. `npm test` and `npm run test:offline` (which includes `tests/integrations/`, described as "no database") now FAIL in any environment without the two staging variables, including a CI job without staging secrets. Before wiring this into CI, either give that job the staging secrets, or move DB-touching integration tests out of `test:offline` (a folder such as `tests/db/` that the DB-backed job runs). I left `package.json` and `vitest.config.ts` alone.

**Notes for the next step:** none beyond the above. INT2 should not depend on DB tests passing until this is unblocked.

## Attempt 2: REV-1 — 2026-11-25
**Status:** done for REV-1. Lane: `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend`. No git, no rm, no migration touched. Read: the REV-1 section of `.baseleap/reviews/REV1.md` (plus its two table rows that mention REV-1), `process-job.ts`, `runner.ts`, `mapping.ts`, `tests/integrations/ghl/{runner.test.ts,helpers.ts}`, `tests/mocks/ghl/simulator.mjs`, and the SQL of `change_quote_request_status`, `claim_ghl_job`, `finish_ghl_job`, `ghl_stage_for_request` in `supabase/migrations/20261120000600_functions.sql` (read only).

**The design (no database change needed).** The stage is read once and then applied, and the lease only protects the database settle, so a slow earlier attempt could land its GHL calls after a newer attempt's. Fix: every attempt that tags a contact now runs `applyStage` (`process-job.ts`): apply the stage it read, then **read `ghl_stage_for_request` again after the calls returned**. Same answer: succeed. Different: apply the newer stage and check again, at most `MAX_STAGE_PASSES = 3` applications. Still moving after that: the attempt does not succeed; it settles as `retry` / `server_error` with log `code: stage_moving` (the database retries in 5 min; if the job was superseded the settle is ignored and the newer change's own job carries the newest stage).
- Why it converges: a pass whose read went stale landed its calls after the newer change committed, so its re-read sees that change and the attempt applies it after its own stale calls. The last call to land is always from a pass whose stage was current when read after the call. Passes applying the same stage commute. A transient "no stage tag at all" (two interleaved remove calls, seen in the test) is repaired by the next pass.
- Applies to the stage-tag job and to `link()` (a copy that links an existing contact). Two requests on one contact converge too because `ghl_stage_for_request` answers per contact.
- Not re-read, deliberately: the **create** path (a status change during a create queues a stage-tag job that waits for the link, then applies the newest stage; a tag call after a successful create could fail and lose the new contact's id), and the job's own lease/superseded state (the stage is the truth; a superseded attempt applies the same stage its replacement does).
- Cost: one extra RPC read per attempt, no extra GHL call when the stage held still.
- Why not the other option (serialise per contact): it needs a per-contact claim, which is SQL.
- Documented in `docs/integrations/ghl.md`, section "Stage convergence".

**The reproducing test (`tests/integrations/ghl/stage-race.test.ts`, simulator `slow` mode)**
- Written first, run against the unchanged runner: `npx vitest run tests/integrations/ghl/stage-race.test.ts --passWithNoTests=false` → **exit 1, 4 failed of 4**. Each failed on the final assertion only (the check made while B had finished and A had not landed passed), with A overwriting B: first-call-slow ended `['quote-quoted','quote-request','vip']`; second-call-slow ended `['quote-request','vip']` (no stage tag at all); the shared-contact case ended `quote-quoted`; the link case ended `quote-quoted`, expected `quote-won`.
- After the fix, same command → **exit 0, 6 passed of 6** (the 4 above plus 2 new: "a stage that holds still" = same 2 GHL calls, 2 reads, success; "a stage that never holds still" = exactly `2 * MAX_STAGE_PASSES` calls, then a retry with `stage_moving`).
- Scenario: A reads "quoted" and is slow (first call, then second call, in two cases); the stage moves to "won"; B reads "won" and finishes first; A lands late. A's settle is simulated as `superseded`, as the database does. The contact must end with `quote-request`, `quote-won` and the owner's own `vip` tag.

**Commands (each as `cd <lane> && …`)**
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0 (0 errors; the same 2 warnings in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs`, not mine)
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/integrations/ghl --passWithNoTests=false` → **refused by the session ("requires approval"); not run in that form**. Fallback as the brief allows: `npx vitest run tests/integrations/ghl --passWithNoTests=false` → exit 0, **6 files, 105 passed, 0 failed, 0 skipped**. Separately `npx vitest run tests/integrations/ghl/db.test.ts` → exit 0, 13 passed: the staging env helper found the staging variables this time, so **the 13 database tests ran against the staging project and passed** (they did not in Attempt 1 or Pass 2). The new tests are offline.
- `npm run build` → exit 0
- `node scripts/check-code-guards.mjs service-role` → exit 0 ("OK")

**Files changed**
- `src/lib/server/integrations/ghl/process-job.ts` — `applyStage` (apply, re-read, converge), `MAX_STAGE_PASSES`, `stageVerdict`; used by `stageTag` and `link`; comment on why the create path is not re-read
- `tests/integrations/ghl/stage-race.test.ts` — NEW, 6 tests
- `docs/integrations/ghl.md` — runner step 2 amended; new "Stage convergence" section (problem, design, why it converges, cost, what is not re-read, residual window, tests); lease sizing note
- `.baseleap/reports/INT1.md` — this section
- No change to `runner.ts`, the simulator, the helpers, any existing test, any migration, any config.

**Could not do / unverified:** live behaviour (no live call; the simulator only proves our logic, not GHL's ordering of concurrent calls). The proof of convergence assumes a GHL call that has returned has been applied (read-your-writes within one caller), which the simulator guarantees and the docs do not state: add it to the unverified-live list if Matthew wants a live check.

**CONTRACT QUESTION (optional hardening, NOT needed for REV-1; architect, SQL):** when a contact copy **links** an existing contact, `finish_ghl_job` stamps `ghl_linked_at = now()` after the GHL calls, and that stamp is what makes the linking request the most recent change. Another request already on that contact that changes status in the milliseconds between the link's last call and that settle can land its tag last, so the contact shows its stage until the next change. Suggested change in `finish_ghl_job` (`supabase/migrations/20261120000600_functions.sql`, contact_copy branch after the `ghl_contact_id` update): insert a pending `stage_tag` job for the request (target_status = its status) when the link succeeded on a contact that already had another consented request linked, so one more attempt re-applies the stage after the stamp. Until then the window is documented in `docs/integrations/ghl.md`. This was not changed here; migrations are not mine.

**Notes for the next step:** `MAX_STAGE_PASSES` is exported from `process-job.ts`. A job that exhausts it shows in the failed-jobs list with `last_error_class = server_error` and the log code `stage_moving`; nothing new for DevOps to wire.
