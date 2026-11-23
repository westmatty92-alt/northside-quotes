# GoHighLevel (HighLevel API v2): profile and runbook

**Status:** INT1 built and tested against the offline simulator only. **No live call has ever been made** (`GHL_PRIVATE_INTEGRATION_TOKEN` and `GHL_LOCATION_ID` are not set). Everything marked "unverified (live)" below is a documented-but-unchecked behaviour.
**Contract:** `docs/integration-contract.md` (source of truth; nothing here changes a direction, a field or a rule). **Code:** `src/lib/server/integrations/ghl/**`. **Tests and simulator:** `tests/integrations/ghl/**`, `tests/mocks/ghl/**`.

## Provider profile
**Official docs:** https://marketplace.gohighlevel.com/docs (pages listed in the contract's Sources, read 2026-11-19 and 2026-11-20; Get Duplicate Contact re-read 2026-11-20 by INT1) · **OpenAPI/SDK:** none used (four hand-typed calls, Zod at the boundary) · **Sandbox:** a dedicated **test sub-account**, never a client's live account (AC-009.8).

| Field | Value | Source |
|---|---|---|
| Base URL / version | `https://services.leadconnectorhq.com`, header `Version: v3` (one constant, `GHL_API_VERSION` in `client.ts`) | contract; Get Duplicate Contact page: "Send `v3`. It is the only available option" |
| Auth options | Private Integration token (sub-account), or OAuth app | Private Integrations page |
| Auth we use + scopes | Private Integration token, `Authorization: Bearer`. Scopes exactly `contacts.readonly` (duplicate search) and `contacts.write` (create, add tags, remove tags). No `locations/tags.write`, custom fields, opportunities, workflows or conversations | contract "Credentials and scopes" |
| Token lifetime / refresh | Does not expire; rotate every 90 days, GHL keeps the old token valid for 7 days after rotation | Private Integrations page |
| Rate limits / on 429 | 100 requests per 10 s burst, 200,000 per day, per location; 429 carries no `Retry-After`. Our peak is about 8 calls per request. A 429 is retried through the job backoff (5 min, 1 h, 3 h, 6 h, 12 h) | Rate limits page |
| Pagination | not used (no list calls) | n/a |
| Webhooks | none in v1: GHL never calls our app, there is no `/api/webhooks/*` route | contract "Events and webhooks" |
| Idempotency support | **none** ("Idempotency-Key is not supported" on Create Contact). We use match-before-create (our database, then GHL duplicate search) and `ghl_sync_jobs` unique `(request_id)` per copy | Create Contact page |
| Data residency | unverified (OQ-12); acceptable only because the sub-account is a test account | SECURITY_MODEL |
| Terms that limit use | none found in the pages read; not reviewed beyond them | |

### The four calls (SECURITY_MODEL invariant 10: nothing else is ever called)
| Call | Used for | Documented reply we rely on |
|---|---|---|
| `GET /contacts/search/duplicate?locationId&email&number` | step 2 of the match rule, and the repeat after a 400 on create | `200 { contact: object \| null, matchingField? }`; `contact: null` when there is no duplicate |
| `POST /contacts` | create (name, firstName, lastName, phone `+1…`, email, address1, tags) | `201 { contact: { id } }`; only `contact.id` is read |
| `POST /contacts/{id}/tags` | add `quote-request` and one stage tag | any 2xx |
| `DELETE /contacts/{id}/tags` | remove the other three stage tags (never `quote-request`, never another tag) | any 2xx |

The client refuses, before any network call, a contact id that is not `^[A-Za-z0-9_-]{1,100}$` (SEC-12), a tag outside the five names, and removing anything but the four stage tags (AC-017.8). Redirects are refused so the token never follows one to another host.

## Environment variables (names only)
| Name | Where | Sandbox → production |
|---|---|---|
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Vercel, Sensitive, Preview and Production. Read only in `client.ts`. Never logged, stored in a table, or returned | Both rows point at the one **test** sub-account token in the rehearsal. A real client gets its own token per project (standing rule 2) |
| `GHL_LOCATION_ID` | Vercel config, not secret | the test sub-account's location id |
| `GHL_API_BASE_URL` | optional, local and preview only (the simulator). **Ignored when `VERCEL_ENV=production`** (SEC-20). An unusable value fails closed as `config_missing` instead of falling back to the real host | unset in Production |
| `VERCEL_ENV` | Vercel system variable | set by Vercel |

## Schedules
`/api/jobs/ghl-sync` (INT2, not built yet) is called by the four Vercel Cron entries the architect planned: `0 0 * * *`, `0 6 * * *`, `0 12 * * *`, `0 18 * * *` (UTC, `vercel.json`, DevOps). The first attempt for each submission and status change runs from `after()` through the seam `runGhlJobs({ requestId })`.

## How the runner works (INT1)
`runGhlJobs(options)` in `index.ts` calls `runGhlJobsWith` in `runner.ts`, the one integration file that uses the service-role client (SECURITY_MODEL invariant 2).
1. `claim_ghl_job` leases **one** due job with a new `lease_id` (contact copies first). Stop when nothing is due, `limit` jobs were claimed, or fewer than 60 s of the 300 s budget remain (`RUN_BUDGET_MS`, `RUN_RESERVE_MS`).
2. `process-job.ts` decides: no consent → `abandon` (a trigger already forbids such a job; this is the second lock). Contact copy: `find_ghl_contact_match` → GHL duplicate search → create (a 400 on create repeats the search once). Stage tag: wait for the copy, else add `quote-request` + the stage from `ghl_stage_for_request`, remove the other three.
3. `finish_ghl_job(job, lease_id, outcome, error_class, contact_id)` settles it. If the lease was lost or the job superseded, the database returns the row unchanged and the runner logs `lease_lost` and moves on.
4. The database writes the metrics events (`ghl_sync_*`, `ghl_tag_sync_*`); the runner writes none. Its log line carries ids, the outcome, the error class and the status code only (`log.ts` allow-list).

A bug inside one job settles it as one failed attempt (`server_error`, bounded retries) and the run continues. A database failure stops the run with `GhlStoreError` (operation and SQLSTATE only); callers wrap it in `after()`.

**No retry loop and no breaker table in the client**, on purpose: retries are the jobs table's (the contract's backoff), and the 120 s lease is sized for three single-attempt 10 s calls.

## What users see when it is down
See the contract's "When the platform is down". In short: the request and the status change are always saved; staff see "Waiting to retry" or "Copy to GoHighLevel failed" / "Stage tag failed" on SCR-06. Homeowners see nothing.

## Simulator (QA: failure drills with no network access)
`tests/mocks/ghl/simulator.mjs`, plain Node, no dependencies, deterministic, in-memory contact book.
- Standalone: `node tests/mocks/ghl/simulator.mjs --port 4510` prints the three values to set: `GHL_API_BASE_URL=http://127.0.0.1:4510`, `GHL_PRIVATE_INTEGRATION_TOKEN=<fake printed value>`, `GHL_LOCATION_ID=<fake printed value>` (preview and local only; the token is a public fake).
- In a test: `startGhlSimulator()` from `tests/mocks/ghl/simulator.mjs` (types in `simulator.d.mts`), then `sim.url`, `sim.token`, `sim.locationId`, `sim.calls()`, `sim.contacts()`, `sim.reset()`.
- Modes (header `x-sim-mode`, `sim.setMode`, or `sim.queueModes([...])` for "fail twice then work"): `ok`, `slow`, `lost_reply` (applied, never answered), `429`, `500`, `revoked` (401), `forbidden` (403), `badrequest` (400), `notfound` (404), `unprocessable` (422), `drift` (renamed `id` and `tags`).
- Settings: `allowDuplicateContact` (default off, so a duplicate create answers 400), `searchLag` plus `flushSearchIndex()`.
- Out-of-process control for browser drills: `POST /__sim/mode {mode, queue}`, `POST /__sim/config`, `POST /__sim/seed`, `POST /__sim/reset`, `GET /__sim/state`.
- **Everything the docs do not describe (all error bodies, the status for a wrong location, the duplicate-refusal body) is invented.** See `tests/mocks/ghl/fixtures/README.md`. The simulator proves our logic, not GHL's behaviour.

Run the suite: `npx vitest run tests/integrations/ghl --passWithNoTests=false`. The database suite (`db.test.ts`) needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment (the ledger's verify loads `.env.local`: `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/integrations/ghl`); it is skipped without them, and fails instead with `REQUIRE_DB_TESTS=1`. It works only on the staging project, scopes every row by a per-run email and deletes its rows afterwards.

## Runbook
| Situation | Check | Fix |
|---|---|---|
| Copies stay "Waiting to retry" | `select request_id, kind, state, attempt_count, last_error_class, next_attempt_at from ghl_sync_jobs where state in ('pending','waiting','failed') order by next_attempt_at;` (job rows hold no personal data) | `timeout`, `server_error`, `rate_limited`: wait, the backoff and the cron run retry. Look at GHL status |
| `config_missing` | `GHL_PRIVATE_INTEGRATION_TOKEN` or `GHL_LOCATION_ID` is unset or malformed in that environment | Matthew sets it through the secrets process; then Retry copy (INT2) re-runs failed copies. Stage-tag jobs that failed with the copy have no retry in v1 |
| `auth` | Token revoked, wrong sub-account, or missing scope | Create or edit the Private Integration (CRM Automation) with exactly `contacts.readonly` and `contacts.write`; replace the token; Retry copy |
| `rejected` on a copy | GHL refused the data (400, 422) or the contact is gone (404) | Fix the data or the contact; Retry copy. A deleted contact is never recreated: Baseleap clears `ghl_contact_id` and `ghl_linked_at` together on the affected requests (the pair check needs both null), then Retry copy |
| Token rotation (every 90 days) | | Create the new token, put it in Vercel, redeploy, then revoke the old one inside GHL's 7-day overlap |
| A person asks to stop emails (NG-16) | | Northside removes the contact or its `quote-request` tag by hand in GHL. The app never re-adds a removed contact for an existing request |

## Unverified (live)
Nothing below has been confirmed against real HighLevel. First live test: the test sub-account, behind Matthew's approval.
1. **Duplicate search after a refused create.** That GHL answers a refused duplicate with HTTP 400, and that the duplicate search then finds that contact. The 400 rule (repeat the search once, then `rejected`) does not depend on the body, but the whole benefit depends on this.
2. **Tag auto-creation (OQ-15).** That `POST /contacts/{id}/tags` creates a tag that does not exist on the location yet. If not, CRM Automation creates the five tags once (no code change); if the token cannot change tags at all, US-017 is cut.
3. **`Version: v3`.** The duplicate-search page says it is the only option; the Private Integrations page example shows `2021-07-28`. If wrong, every call fails as `server_error` until the one constant changes.
4. **Duplicate search return for `contact`.** `contact: null` is documented for "no duplicate"; the shape of a 200 with a match, and whether a miss can ever be a 404 (which the client would treat as `rejected`), are unchecked.
5. **Which field wins** when one search carries an email and a phone that belong to two different contacts (`matchingField`).
6. **Search right after a create.** Whether a contact created seconds earlier is found (the lost-reply case relies on the next attempt, 5 minutes later).
7. **`firstName` / `lastName` next to `name`** accepted unchanged, or derived by GHL (OQ in the contract).
8. **`DELETE /contacts/{id}/tags` with a JSON body** works through Node's `fetch` (documented as a body; not exercised against GHL).
9. **Statuses for situations the docs do not describe**: a wrong location id, a deleted contact on a tag call (assumed 404), a value refused (assumed 422), the tag endpoints' reply bodies (we require only a 2xx).
10. **429 without `Retry-After`** (documented; unobserved) and the real 100 per 10 s window.
11. **Phone and email normalisation**: `+1` plus 10 digits accepted; email lower-cased by GHL.
12. **Scope sufficiency**: that `contacts.readonly` alone covers the duplicate search.
13. **Typical latency** against the 10 s timeout.
14. **"Allow Duplicate Contact" off** in the test sub-account (CRM Automation to check; the second guard behind our search).

## Handoffs
- **DevOps:** the four `ghl-sync` cron entries (INT2 builds the route, DevOps owns `vercel.json`); alert on `ghl_sync_jobs` rows in `failed` (the contract's "needs attention" list; Sentry is not approved); `GHL_API_BASE_URL` must stay unset in Production.
- **CRM Automation** (contract "Setup the platform side must do"): create the Private Integration in the test sub-account with the two scopes; check "Allow Duplicate Contact" is off; create the five tags by hand only if the first live test shows they are needed.
- **Matthew:** set `GHL_PRIVATE_INTEGRATION_TOKEN` and `GHL_LOCATION_ID` through the secrets process when ready.

## Evidence
Contract sections read: all of `docs/integration-contract.md`. Migrations read: `20261120000300_quote_requests.sql`, `20261120000400_ghl_sync.sql`, `20261120000600_functions.sql` (claim, finish, match, stage). Architecture: "Modules", "Integration seam", "Build requirements from S0" and "from PRD v1.2". Metrics: the six `ghl_*` events (written by `finish_ghl_job`, not by the runner).
