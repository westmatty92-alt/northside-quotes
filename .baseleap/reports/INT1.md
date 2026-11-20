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
