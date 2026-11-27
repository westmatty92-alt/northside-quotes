# STEP BE3 — Inbox reads and writes: list, detail with GHL state, photos refresh, saveQuote, status change, weekly count
## Attempt 1 — 2026-11-20
**Status:** done

**Read:** the ledger entry (`plan-build.json`, BE3), `docs/openapi.yaml` (the six operations, `Problem`, `Unauthorized`, `NotFound`, `Conflict`, `ValidationError`, `BadRequest`), `docs/architecture.md` ("GHL state shown on SCR-06", Modules, Key queries, both "Build requirements" sections), `docs/SECURITY_MODEL.md`, `docs/metrics-spec.md`, `docs/user-stories.md` (US-005 to US-008, US-010, US-011, US-012, US-013, US-015, US-016, US-017), migrations 0300, 0400, 0600 (`list_quote_requests`, `save_quote_request_quote`, `change_quote_request_status`, `weekly_counts`, `weekly_counts_at`), 0700 (storage policies), the BE1 and BE2 reports and code (`http.ts`, `require-staff.ts`, `submissions.ts`, the submission route and its test).

**Assumptions (the contract is silent or the ledger text differs; each is a one-line change):**
1. **Non-staff signed-in user is 401 `session_expired`, not 403.** The ledger acceptance line says 403; the contract (`Unauthorized`: "or not a staff member (code session_expired)"), the SECURITY_MODEL permission matrix and BE2's `requireStaff` all say 401, and no staff operation in the contract lists 403. "No new status codes" wins. See CONTRACT QUESTION.
2. A database failure on a staff read or write is **500 `internal_error`**, not 503: none of the six operations lists a 503 (BE2 made the same call for `requireStaff`). PT401, PT404, PT409 and PT422 keep their own codes. Only `{ error_class: 'postgrest', code }` is logged.
3. A malformed cursor (not decodable, wrong shape, over 200 characters, two cursor parameters) is 400 `bad_request`, checked before every other parameter and after the session. Other bad query values (`status`, `q`, `limit`, an unknown parameter, a repeated parameter, `q=`) are 422 naming the field.
4. A path id that is not a uuid is 404, like an unknown id.
5. The body is validated before the id is looked up, so an invalid body on an unknown id is 422, not 404 (the caller is a signed-in staff member; nothing is revealed).
6. `note` and `q` lengths are counted in code points (as the contract and Postgres `char_length` count them), not UTF-16 units: 1,000 emoji are a valid note. `note` or `q` containing NUL or a lone surrogate is a 422 on that field (Postgres cannot store it; it would otherwise be a database 500).
7. After a real status change the stage-tag attempt is scheduled only when a `stage_tag` job in `pending` or `waiting` exists for the request (an unticked request never has one). If that check itself fails, the status is still saved, 201 is sent, and the attempt is scheduled anyway (it claims nothing when there is no job).
8. `photo_count` in the detail is the stored column. `expires_at` is taken before signing so it is never later than the real expiry. A photo Storage cannot sign, or all of them when Storage is down, get `url: null, expires_at: null` and the rest of the answer is sent (AC-005.7).
9. The cursor is `c1.` + base64url of `[submitted_at as PostgREST returned it (microseconds, +00:00), id]`. It keeps the microseconds because a JS `Date` would round to milliseconds and break the keyset.

**Files changed (all inside the owned paths):**
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/lib/server/services/quote-requests.ts` (new) — the six services: `parseListQuery`/`encodeCursor`/`decodeCursor`, `listQuoteRequests` (the `list_quote_requests` RPC only, `limit + 1`), `getQuoteRequest` (request + staff display name + photos + two job reads, in parallel), `listQuoteRequestPhotos`, `mapGhlState` (pure), `saveQuote`, `changeQuoteRequestStatus`, `getCurrentWeeklyCount`. User-scoped client only; no service-role import; no filter strings.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/quote-requests/route.ts` — GET added (`requireStaff` first); POST untouched.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/quote-requests/[request_id]/route.ts` (new) — GET; 405 for the rest.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/quote-requests/[request_id]/photos/route.ts` (new) — GET.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/quote-requests/[request_id]/quote/route.ts` (new) — PUT.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/quote-requests/[request_id]/status-changes/route.ts` (new) — POST; `runGhlJobs({ requestId })` inside a wrapped `after()`, logging `{ error_class, code }` only.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/src/app/api/weekly-counts/current/route.ts` (new) — GET.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/tests/helpers/inbox.ts` (new) — seeding (service role, tracked for cleanup), staff sessions, request builders, `psqlOutput`.
- `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend/tests/api/inbox/list.test.ts`, `detail.test.ts`, `quote.test.ts`, `status.test.ts`, `weekly-count.test.ts`, `auth-matrix.test.ts`, `list-plan.test.ts` (all new).
- No other file touched (`http.ts`, `require-staff.ts`, `staging.ts`, `staging-env.ts` unchanged).

**Commands run** (lane `/home/admin/baseleap/rehearsal/northside-quotes-wt-backend`, hosted STAGING Supabase project, not local):
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0, 0 errors, 2 warnings (`scripts/lib/yaml-lite.mjs`, `scripts/sync-agent-permissions.mjs`: not mine, not new)
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/api/inbox --passWithNoTests=false` → **refused by the permission layer here**; used the allowed fallback `npx vitest run tests/api/inbox --passWithNoTests=false` → exit 0, **7 files, 258 passed, 0 failed, skipped 0** (list 63, detail 31, quote 38, status 40, weekly-count 16, auth-matrix 69, list-plan 1). Run three times in a row (files in parallel) with the same result.
- `npx vitest run tests/api/auth tests/api/submission tests/api/housekeeping tests/api/health tests/unit --passWithNoTests=false` → exit 0, 19 files, 352 passed (BE1 and BE2 regression, incl. `no-account-routes` which scans the route tree)
- `npm run build` → exit 0; route table lists `/api/quote-requests`, `/api/quote-requests/[request_id]`, `.../photos`, `.../quote`, `.../status-changes`, `/api/weekly-counts/current`, all `ƒ` dynamic
- `node scripts/check-code-guards.mjs service-role` → `OK`

**Acceptance criteria → test** (file: test; all under `tests/api/inbox/`):
- *list is newest first, paginates by cursor, filters by status and search, rejects a malformed cursor with 400*
  - AC-005.1 `list.test.ts` "lists requests submitted at 09:00, 09:05 and 09:10 as 09:10, 09:05, 09:00" (exact summary object); AC-005.2 "a request submitted after the first load is at the top"; AC-005.4 "an empty result is data [] and next_cursor null"; AC-005.5 "51 requests: the default page is the 50 newest with a cursor, the second page is the last 1" and "limit sets the page size: 20, 20 and 11"; keyset "rows with the same time, or times that differ by microseconds, are neither skipped nor repeated" (limit 1 and 2, six rows in one millisecond); "a cursor made from a real page keeps working when the list grows"
  - AC-011.1 / AC-011.2 "the status filter lists exactly that status, newest first; an empty filter is data []"; AC-016.10 "51 Quoted and 2 New: Quoted shows its 50 newest then 1 more, New shows both with no cursor"; "the status filter alone (what each Pipeline column sends, no q)"
  - AC-013.1 / .2 / .3 reference in any case, nothing found, part of a name in any case; phone digits typed three ways; search + status + cursor; blank search
  - Cursor 400: 21 malformed cursors (garbage, empty, prefix only, bad base64url, other version, not JSON, wrong shapes, non-uuid, upper-case uuid, 31 February, month 13, no zone, other zone, 7 fractional digits, SQL in the time, filter string in the id, over 200 characters), each with a spy proving **the list RPC was never called**; two cursor parameters; cursor checked before other parameters and after the session (no session is 401)
  - SEC-13: ten attacks as `q` (SQL, PostgREST filter syntax, `%`, `_`, backslash, quote, `*`, 100 characters) match only literally; the table and the seeded row survive; the search text is not in the log line; source test: no `.or(`, `.filter(`, `.ilike(`, `.like(`, `.textSearch(` and no admin client in the service or routes
  - 422: 14 cases (status, limit, q, unknown and repeated parameters), every bad parameter named once
- *saveQuote and status change with a stale version return 409 and change nothing; AC-006.3 prices give 422*
  - AC-006.1 `quote.test.ts` "saves 450.00 and a note, returns the updated request, and a reload shows both"; AC-006.2 "a note with no price"; AC-006.3 "0, 100000.00 and 450.555 are refused with the price named; 0.01 and 99999.99 are stored exactly" (plus negative, 0.015, 1e21, wrong types) with the stored row unchanged after every refusal; AC-006.4 "1,000 characters are stored; 1,001 are refused", emoji counted as characters, NUL and lone surrogate 422; AC-006.5 "a save with a stale version is 409 stale_version and the first save is not overwritten" and "five saves of the same version at once: exactly one wins, four are 409, one event"; AC-006.6 "a new price replaces the old one"
  - AC-007.1 to .3 `status.test.ts` (new to won, new to quoted to lost, won to lost, all 12 moves); AC-007.4 / AC-016.6 / AC-017.5 "choosing the current status changes nothing" (200 `changed:false`, same version and time, no history, no event, no job, no GHL attempt); AC-007.5 / AC-016.8 "the order by submitted time is the same before and after a move"; AC-007.7 "one audit row (from, to, user, time) and one event"; AC-016.12 / AC-006.5 "the owner drags a card still shown as new, but the helper already moved it to won" (409, one history row, one event, one job, no GHL attempt), "a version ahead", "five moves of the same version at once"
  - metrics-spec: `quote_request_quoted` exactly once with `{request_id, minutes_since_submit}` only, never for a note, never again after clearing and re-pricing, never when moving to quoted; `quote_request_status_changed` exactly once per real change with `{request_id, from_status, to_status, user_id}`, none for the same status or a refused save
- *an unticked request's detail shows ghl.copy.state not_copied_no_consent and stage_tag null*
  - AC-010.6 / AC-017.16 `detail.test.ts` "an unticked request is not_copied_no_consent with at null and stage_tag null" (also `marketing_consent false`, `marketing_consent_at null`; the database refuses a job for it); AC-017.16 `status.test.ts` "an unticked request: the status is saved, no job exists and the GHL seam is never called"
  - Mapping table, 12 cases (AC-010.1, .3, .4, AC-017.1, .6, .9, .10, .11): copy succeeded/pending/waiting/failed, stage tag succeeded/pending/waiting/failed, newest non-superseded decides, superseded ignored, follows the copy, no jobs at all; a ticked request returns `marketing_consent true` and the time of consent
  - AC-005.3 "returns the request in full, with 3 signed photo URLs that open, in position order" (the signed URL is fetched for real: 200, `image/jpeg`, JPEG bytes); AC-005.6 no photos; AC-005.7 Storage 503 and Storage unreachable (every photo `url null`, rest intact, `photo_signing_failed` logged without the Storage text), and one missing file; AC-012.3 `listQuoteRequestPhotos` fresh URLs on every call that open, `expires_at` within 30 s of +900 s, position order, `{data: []}` for none; a signed URL is never written to the log; the object path without a signature, and the public URL, are refused; AC-015.1 / .2 `last_updated` (display name and time; null; null name after the staff row is removed)
- *weekly count counts won/lost by status-change date in America/Toronto Mon-Sun*
  - `weekly-count.test.ts`. **Isolated far-future week, absolute numbers** (through `app_private.weekly_counts_at`, the function behind the route): AC-008.7 0,0,0; AC-008.3 Monday 00:00:00 and the last second in, Sunday 23:59:59 before and Monday 00:00:00 after out; AC-008.1 4, 1, 1; AC-008.4 submitted last week, won this week; won and lost on the four boundary instants; AC-008.5 won then lost counts for lost only; quoted, new and pending never won or lost; **AC-008.6** the week where daylight saving ends (169 h, midnight 04:00Z to 05:00Z, Sunday 23:59:59 counted) and the week where it starts (167 h); nine instants all give a Monday 00:00:00 Toronto start 7 calendar days before the end. **The route, current week:** Monday-to-Monday bounds, no parameter picks another week (NG-10), and the route's three numbers equal an independent service-role count at a quiet moment with rows of ten kinds present (each row checked one by one for being counted or not); AC-008.2 / AC-008.5 through the real status route: new, won, lost, same status, quoted; AC-008.8 a database failure is 500 with nothing from the database in the response or log
- *401 without a session, a non-staff user, 404 for an unknown id on every staff route*
  - `auth-matrix.test.ts` (all six operations): no header, empty bearer, other scheme, junk, `undefined`, 5,000 characters, cookie only, forged signature: 401 `session_expired`, one identical body, write routes write nothing (request, history, events, jobs, GHL seam untouched); non-staff signed-in user: 401 on every route and RLS shows them nothing directly; owner and helper both succeed on every route and are recorded under their own display names; unknown uuid, non-uuid and pending id: 404 on the four id routes, identical body for "never existed" and "pending"; no session with an unknown id is 401, never 404; 405 with `Allow` on seven unlisted method/path pairs without a session; session over 7 days (6 days still 200) and a removed staff member: 401 on every route; source test: every handler awaits `requireStaff(req)` before it reads the body, query, id or calls a service
- Contract: every 200/201 is parsed with the generated Zod response schema and its exact key list; every 4xx/5xx is `application/problem+json` matching `Problem` with the contract code and `x-request-id`; failure bodies and log lines are checked to contain no database text (`message`, `details`, `hint`, failing row) for list, detail, quote, status and weekly count.

**Auth-matrix results:** no session 401 · bad token 401 · cookie only 401 · non-staff 401 (not 403, see below) · removed staff 401 · session over 7 days 401 · owner 2xx · helper 2xx · unknown or pending id 404 · wrong method 405.

**EXPLAIN notes** (staging database, `EXPLAIN (ANALYZE, BUFFERS)`, 2,400 submitted requests inserted inside a transaction that is rolled back — the PRD's year of volume; staging keeps nothing, the test proves `0` left). `list_quote_requests()` is a SQL function with a CTE, so a plain `EXPLAIN` of a call is only a Function Scan (0.7 ms); the plans are of the function's own SELECT with the parameters as literals. Run as the database owner, so the RLS qual (`is_staff() and state = 'submitted'`) is not in the plan; that qual is the same one the partial indexes already assume.
| Query | Plan | Execution |
|---|---|---|
| newest first, 50 per page | `Limit` -> `Index Scan using quote_requests_inbox_idx`, no Sort, no Seq Scan | 0.13 ms |
| status filter (a Pipeline column) | `Index Scan using quote_requests_status_inbox_idx`, `Index Cond: status = 'quoted'` | 0.11 ms |
| keyset page after a cursor | `Index Scan using quote_requests_inbox_idx`, `Index Cond: ROW(submitted_at, id) < ROW(...)` | 0.11 ms |
| keyset page inside a status filter | `Index Scan using quote_requests_status_inbox_idx`, `Index Cond: status = 'won' AND ROW(...) < ROW(...)` | 0.16 ms |
| search by name | `Index Scan using quote_requests_inbox_idx` with `Filter`, 1,188 rows removed to find 51 | 1.6 ms |
| search by reference (no match) | same index scan, filter removes all 2,400 rows | 2.7 ms |
| search by phone digits (no match) | same, filter removes all 2,400 | 2.3 ms |
The first four are index-served with no sort, as the architecture's key-query table says. Search is a filtered scan by design (no index); worst case (no match) reads the whole table in under 3 ms at a year of data. No finding for the architect on the plans. `tests/api/inbox/list-plan.test.ts` asserts the first four (index named, no Sort, no Seq Scan) and a 250 ms ceiling on all seven.

**Observations (not changed; not mine to change):**
- `list_quote_requests` extracts the digits from **any** `q` and phone-matches them when there are 3 or more. So searching a reference such as `NQ-7K3M9P` (digits `739`) also returns any request whose phone contains `739`. The reference still matches exactly and is listed (AC-013.1 holds), but the result can include unrelated rows. Minor, for the architect: only treat `q` as phone digits when it has no letters. My tests assert "is listed" rather than "listed alone" because of it.
- `npm run lint` shows the two pre-existing warnings in `scripts/`.

**Honest limits of the tests:**
- `after()` is replaced by a stand-in that runs the task at once (the same technique as BE1's submit test), and `runGhlJobs` by a spy. This lane still has A2's no-op seam; INT1's real runner is integrated separately. So **unverified:** the real `after()` inside a running Next server (the code is the same shape as BE1's submission route, and `next build` compiles it).
- The route-vs-independent-count weekly test needs a moment when no other file changes the current week (it retries for up to 30 s). It passed 3 of 3 full parallel runs; it could in principle fail if another writer never paused for 30 s. The week arithmetic itself does not depend on that (isolated weeks, absolute numbers).
- Real Auth calls: 9 password sign-ins per full `tests/api/inbox` run (throwaway users, one per file, four in the matrix file). I did not find Supabase's per-address Auth limit; running BE2's suite and this one back to back is about 23 sign-ins in a minute.
- Every request, photo file, job, history row, event and throwaway user is deleted in `afterAll` and proven gone by `tests/helpers/staging.ts`; the plan test's data is rolled back and checked. Tests run on the hosted staging project only (`stagingEnvProblem` refuses a production ref). Missing variables fail the files; nothing skips (skipped 0).
- No secret in any file, log or this report; staging variables are read by name through `tests/helpers/staging-env.ts` only.

**Could not do:** nothing in the step.

**CONTRACT QUESTION:**
1. **Need:** confirm that a signed-in user who is not staff is **401 `session_expired`**, not 403. **Why:** the ledger's BE3 acceptance text says "403 for a non-staff user", but `docs/openapi.yaml` (`Unauthorized`, and no 403 response on any staff operation), `docs/SECURITY_MODEL.md` (permission matrix: "Non-staff signed in … 401 `session_expired`") and BE2's `requireStaff` all say 401, and I may not add a status code. I implemented and tested 401. **Artifact:** the ledger step text only; the contract is already consistent. **Suggested change:** correct the ledger acceptance line to 401 (no contract or code change).

**BLOCKED:** none.

**Notes for the next steps:**
- **INT2:** `retryGhlCopy` can reuse `requireStaff`, `withApi`, `dbProblem` the same way; for the detail's `ghl.copy` mapping, `mapGhlState` is exported from `src/lib/server/services/quote-requests.ts` if the retry result needs the same words. `runGhlJobs({ requestId })` is called after a real status change only when a `stage_tag` job is `pending` or `waiting`.
- **FE:** a list `cursor` is opaque, at most 200 characters; send it back unchanged. A `q` of 3 or more digits also searches phone numbers. A 500 from the weekly count is "Count unavailable". Photo `url` and `expires_at` are both `null` when a photo could not be signed.
- **QA:** the stale-version, one-event, no-GHL-call-without-consent and sign-in-session rules above are proven at the API level against staging; what is not proven here is the browser flow and the real `after()` in a running server.

## Attempt 2: QA2 fix (2026-11-24)

**Status:** done. Fixes BUG-QA2-4 (class impl). The contract, migrations and generated code are untouched.

**Root cause (confirmed, not guessed):** the 32-bit integer overflow. `quote_requests.version` is `integer` (`supabase/migrations/20261120000300_quote_requests.sql:55`), and the `p_expected_version` argument of both `save_quote_request_quote()` and `change_quote_request_status()` is `integer` (`20261120000600_functions.sql:441` and `:505`). The contract says `version: integer, minimum: 1` with no `maximum` (CQ-QA2-1, deferred). The request schemas in the service used the generated `zod.int().min(1)`, and in zod 4 `int()` only means "a safe JavaScript integer", up to 9,007,199,254,740,991. So any version above 2,147,483,647 passed validation, was sent to the database as the RPC argument and was refused there. The reproducing test's log lines for the 500s show `error_class: postgrest, code: 22003` (numeric_value_out_of_range). `dbProblem` has no case for that code, so it became the generic 500 `internal_error`. It happened before the not-found answer because the function casts its arguments before it looks the request up. The same schema lets such a value through for an unknown id and for an existing one.
Which values were affected: only those that are whole numbers above 2,147,483,647 and at most 9,007,199,254,740,991, in any spelling (`2147483648`, `10000000001`, `367499305219`, `1e10`, `2147483648.0`, `9007199254740991`). The others in the same class (a float, text, null, zero, negatives of any size, `9007199254740993` and above, `1e400`, a 34-digit number) were already 422 from zod, and the new test pins that down as well.

**Reproducing test (written first, red before the fix):** `tests/api/inbox/version-range.test.ts`, run against the staging project. For both routes it sends 24 `version` values as raw JSON text (as QA's PRB-45 does), to an existing request and to an unknown uuid, plus the boundary and a positive case:
- every refused value must be 422 `validation_failed` with `errors` naming exactly `version`, as `application/problem+json`, with no database wording in the body;
- the log must hold no `postgrest` or `22003` line;
- for the existing request, no fetch to `/rpc/save_quote_request_quote`, `/rpc/change_quote_request_status` or `/quote_requests` is made, so no database call is reached after the staff check, and the stored row is unchanged (version 1, nothing in the status history);
- an unknown id gives the same 422 (the 422 comes before the 404);
- the top of the range, `2147483647`, is accepted by validation: 409 `stale_version` for an existing request, 404 for an unknown one, nothing stored;
- `1.0` is the whole number 1 and is accepted (200 or 201).
Red result before the fix: `Tests 24 failed | 334 passed (358)`, every failure "expected 500 to be 422" and every log line `code":"22003"`. The 24 are 6 whole-number values x 2 routes x 2 request kinds.

**Fix:** `src/lib/server/services/quote-requests.ts` only. One shared schema, `const Version = z.int().min(1).max(2_147_483_647)`, replaces the generated `version` field in the two request schemas: `SaveSchema = SaveQuoteBody.extend({ note, version: Version })` and `StatusSchema = ChangeQuoteRequestStatusBody.extend({ version: Version })`, both still `.strict()`. The existing error mapping (`validationErrors`) names `version` with the existing message ("Reload the request and try again"), so there is no new status code, no new field and no handler change. The check runs in the service before any `db.rpc`, so it never reaches the database. The generated schemas and `docs/openapi.yaml` are not edited; the missing `maximum` stays CQ-QA2-1.
Not touched, for the record: a request whose stored version is already 2,147,483,647 could not be saved or moved (`version + 1` would overflow inside the function). That needs two billion saves of one request and is not reachable; no test, no change.

**Commands (each with the `cd` prefix, one command per call):**
- `npm run typecheck` -> exit 0 (`next typegen && tsc --noEmit`, no errors)
- `npm run lint` -> exit 0 (0 errors; the 2 warnings are the existing ones in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs`, not mine)
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/api/inbox --passWithNoTests=false` -> refused by the permission layer ("multiple operations ... require approval"), so the fallback below was used, as the brief allowed. It was refused on every try, before and after the fix.
- `npx vitest run tests/api/inbox --passWithNoTests=false` -> before the fix: exit 1, 24 failed | 334 passed (358). After the fix: exit 0, 8 files passed, 358 tests passed (358), against the hosted staging project (not a local stack).
- `npm run build` -> exit 0 (Next.js 16.4.6 Turbopack, compiled, all routes listed, including the quote and status-changes routes)
- `node scripts/check-code-guards.mjs service-role` -> exit 0 (`check-code-guards service-role: OK`)

**Files changed:**
- `src/lib/server/services/quote-requests.ts` (modified): the `Version` schema and its use in `SaveSchema` and `StatusSchema`.
- `tests/api/inbox/version-range.test.ts` (new): the reproducing and regression test above.
- `.baseleap/reports/BE3.md` (this section).
No temporary files were created. QA's probes (`tests/e2e/**`, PRB-45) were not touched and not run; the preview needs this code first. Unverified: PRB-45 itself on the staging preview, which sends the same values over HTTP; the 6th value there (34 digits) is 422 by the same path as before.

**Could not do:** nothing.
**CONTRACT QUESTION:** none new. CQ-QA2-1 (a `maximum: 2147483647` on `version` in `QuoteSave`, `StatusChangeCreate` and the three response schemas) stays as QA recorded it. With the code now answering 422 for these values, the contract should say so, so the fuzzer treats them as invalid input.
**BLOCKED:** none.

## Attempt 3: REV-4 (2026-11-25)

**Status:** done. Fixes REV-4 (`tests/api/inbox/weekly-count.test.ts` waited up to 30 s for a quiet shared database). The route, the service, the contract, migrations and generated code are untouched; only tests and test helpers changed.

**Read:** this report, the REV-4 section of `REV1.md` only, the weekly-count route and `getCurrentWeeklyCount`, `weekly_counts()` / `weekly_counts_at()` in `20261120000600_functions.sql`, `app_private.is_staff()` (`20261120000200_staff.sql`), the `quote_requests` select policy and grants (`20261120000300_quote_requests.sql`), `tests/helpers/inbox.ts`, `tests/helpers/staging.ts`, `vitest.config.ts`.

**Why the route can't take a week parameter:** `getCurrentWeeklyCount` calls `db.rpc('weekly_counts')` with no arguments, and `weekly_counts()` is `select * from app_private.weekly_counts_at(now())`. NG-10 and the contract offer only the current week, so nothing in my files can pick another week without changing the route's behaviour. The far-future-week tests already call `weekly_counts_at(instant)` directly and assert exact numbers. They are kept unchanged. The current week is now proven in three links, each exact on a busy database, with no retry and no waiting:
1. **The route delegates.** A pass-through `fetch` spy records the route's database calls. There is exactly one call to `/rpc/weekly_counts`: POST, body empty or `{}` (no week argument), `Authorization: Bearer <the staff token>` (the user-scoped client, so RLS applies). The route's JSON equals that captured row mapped field by field. A second test stubs the row with distinct numbers (1234, 56, 7) and PostgREST timestamp text, so a swapped field can't hide behind equal real numbers.
2. **One snapshot, delta against a baseline read in the same transaction.** `snapshot(ids)` runs one `begin isolation level repeatable read read only` transaction through psql. As the staff member (`set local role authenticated` plus the token's `sub`/`session_id` claims; `app_private.is_staff()` is asserted true inside), it reads `weekly_counts()` and checks that row equals `weekly_counts_at(now())`. Then, as the database owner and in the same snapshot, it runs independent plain counts of all rows and of every row that is **not** this test's (the baseline). Assertions: function = independent count, and function minus baseline = exactly what this test's rows must contribute. Rows of all ten kinds give exactly 5 requests, 2 won, 2 lost (AC-008.1, AC-008.3 Sunday 23:59:59 out and Monday 00:00:00 in, AC-008.4 submitted last week and won this week counts as won, not as a request, pending never counted). The real status route then moves one request through new, won, lost, lost again (200, no change) and quoted, giving exactly (1,0,0), (1,1,0), (1,0,1), (1,0,1), (1,0,0) (AC-008.2, AC-008.5: won and lost by status-change date). Snapshot bounds equal the route's `week_start`/`week_end`. The Monday-to-Monday Toronto bounds test and the NG-10 test are kept as they were.
3. **Proof under load.** `tests/helpers/busy-week.ts` (new) is a concurrent writer. It inserts a current-week request and moves an earlier one between won and lost about every 100 ms, all through `ib.seed`, so it is tagged and deleted in `afterAll`. The new test takes 5 snapshots and 5 route calls while the writer runs. Each time it asserts that the writer wrote during that iteration, and at the end that the week's totals changed between snapshots. Every contribution is still exactly (2,1,1). `psqlOutputAsync` (new, in `tests/helpers/inbox.ts`) runs psql without blocking the event loop, so the writer really runs while the transaction is open. `execFileSync` would have paused it.

**The old test's fragility, shown first:** I temporarily started the same writer around the old route describe block (a demo hook, removed afterwards; nothing else changed in the old file). `npx vitest run tests/api/inbox/weekly-count.test.ts --passWithNoTests=false` exited 1 twice in a row: `Tests 2 failed | 14 passed (16)`. Both failures were the `quietComparison` tests ("the three numbers are exactly the independent count..." and "AC-008.2 and AC-008.5 ..."), each `TestTimeoutError: Test timed out in 60000ms`: no quiet moment ever came.

**After the change:** `npx vitest run tests/api/inbox/weekly-count.test.ts --passWithNoTests=false --silent` exited 0: 20 passed (20), 27 s, including the busy-writer test.

**Stability (full inbox suite, files in parallel, back to back, hosted STAGING project, not a local stack):**
- run 1: exit 0, 8 files, 362 passed (362), 35.2 s
- run 2: exit 0, 8 files, 362 passed (362), 33.8 s
- run 3: exit 0, 8 files, 362 passed (362), 31.5 s

**Commands (each with the `cd` prefix):**
- `npm run typecheck` -> exit 0 (`next typegen && tsc --noEmit`, no errors)
- `npm run lint` -> exit 0, 0 errors, 2 warnings (the existing ones in `scripts/lib/yaml-lite.mjs` and `scripts/sync-agent-permissions.mjs`, not mine)
- `node --env-file-if-exists=.env.local node_modules/.bin/vitest run tests/api/inbox --passWithNoTests=false` -> refused by the permission layer ("contains multiple operations ... requires approval"), as in attempts 1 and 2. Used the allowed fallback `npx vitest run tests/api/inbox --passWithNoTests=false` (with `--silent` to keep the JSON log lines out of the output) -> exit 0 three times, results above.
- `npm run build` -> exit 0 (Next.js 16.4.6 Turbopack; `/api/weekly-counts/current` listed, dynamic)
- `node scripts/check-code-guards.mjs service-role` -> exit 0, `check-code-guards service-role: OK`

**Files changed:**
- `tests/api/inbox/weekly-count.test.ts` (modified): `quietComparison`, the JS `independentCount` and `sleep` are removed. Added `snapshot()`, `contribution()` and `staffClaims()`, and the two route tests now use them. Four new tests: the route makes one call and returns the row unchanged; distinct-number mapping; `weekly_counts()` = `weekly_counts_at(now())` = independent count for the staff caller; exact while a concurrent writer runs. The isolated-week and failure/method tests are unchanged. Header comment updated.
- `tests/helpers/busy-week.ts` (new): the concurrent current-week writer.
- `tests/helpers/inbox.ts` (modified): `psqlOutputAsync`. On failure it keeps only psql's `ERROR:` line, never connection details.
- `.baseleap/reports/BE3.md` (this section).
No temporary files are left; the demo hook was removed (no `DEMO`, `quietComparison` or `sleep(` remains in the file).

**Honest limits:**
- The only time-dependent window left: if Monday 00:00 Toronto passes between a test seeding rows anchored at "now" and its snapshot (a few seconds, once a week), the current week changes under the test and it fails. The old test had the same window. Any current-week test has it, because the route can only answer for now.
- The snapshot's staff part sets the claims PostgREST would set (`sub`, `session_id`, `role`) from the test's own token. It does not go through PostgREST. That link is covered separately by the route-delegation test, which uses the real token on the wire.
- The busy writer adds about 30 to 60 short-lived tagged rows per run to the current week on shared staging, all deleted and proven gone in `afterAll`.

**Could not do:** nothing.
**CONTRACT QUESTION:** none.
**BLOCKED:** none.
**Notes for the next step:** the other REV items assigned to the backend (REV-5, REV-6, REV-8, REV-10, REV-12, REV-13) were not touched in this attempt.
