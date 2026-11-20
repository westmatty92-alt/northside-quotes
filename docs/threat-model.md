# Threat model: Northside quote requests (2026-11-19, step S0)

**Author:** bl-security · **Reviewed:** the A1 blueprint at `23c6744` (round 1), then the architect's S0 fixes at `6f1372d` (round 2, re-review). No application code exists yet. · **Verdict and routable directives:** `.baseleap/reviews/S0.md`
**Read in full (round 1):** `docs/PRD.md` (requirements, non-goals, open questions), `docs/architecture.md`, `docs/SECURITY_MODEL.md`, `docs/openapi.yaml`, `docs/integration-contract.md`, `docs/decisions/0001` to `0004`, all seven files in `supabase/migrations/`, all twelve files then in `supabase/tests/`. **Grepped:** `docs/user-stories.md` (AC-003, AC-004, GHL role), `docs/metrics-spec.md` (event properties), `docs/design-specs.md` (consent), `docs/ops/account-setup.md` (Auth settings, secret rows), `.env.example` (names only).
**Round 2:** every migration and `docs/SECURITY_MODEL.md` re-read in full at `6f1372d`; `supabase/tests/rls/all_tables.sql`, `storage_objects.sql`, `events.sql`, `supabase/tests/functions/submission_and_limits.sql` and `complete_and_sync.sql` read in full; the `docs/architecture.md`, `docs/openapi.yaml` and `docs/integration-contract.md` diffs read in full.
**Not run yet:** none of the migrations has run on a database (A2 runs them on staging first). Every statement below about database behaviour comes from reading the SQL. The checks that need a live database are listed under "Live checks for A2".

## Assets
| Asset | Why an attacker wants it | Where it lives |
|---|---|---|
| Homeowner personal data: name, phone, email, home address, problem text | identity theft, a target list ("this house has a burst pipe and an emergency"), selling leads to a competitor | `public.quote_requests` (ca-central-1) and a copy of name, phone, email and address in the GHL test sub-account |
| Photos of the inside of homes (may carry EXIF GPS) | burglary reconnaissance, privacy harm | private Storage bucket `quote-photos` |
| Staff powers: change price, note or status, re-arm a GHL copy | sabotage the pipeline (mark every lead Lost), wreck the metrics | `security definer` RPCs gated by `app_private.is_staff()` |
| Staff sessions (Supabase access and refresh tokens) | all of the above for up to 7 days | `sb-*-auth-token` cookies, readable by JavaScript by design (`httpOnly` false) |
| `SUPABASE_SERVICE_ROLE_KEY` | read and write every table, bypassing RLS | Vercel env (Sensitive), read only in `src/lib/server/admin.ts` |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | read and write every contact in the sub-account (`contacts.readonly`, `contacts.write`) | Vercel env (Sensitive), read only in `src/lib/server/integrations/ghl/client.ts` |
| `APP_SIGNING_SECRET` | forge form tokens (skip the 3-second trap), turn the IP and email HMACs back into addresses | Vercel env (Sensitive), read only in `src/lib/server/env.ts` |
| `CRON_SECRET` | trigger the job routes whenever wanted | Vercel env (Sensitive), read only in `src/lib/server/env.ts` |
| Integrity of the record | fake leads, forged audit rows, a second GHL contact for one request | `quote_requests`, `quote_request_status_changes`, `ghl_sync_jobs` |
| Availability at $0 | stop real homeowners from sending requests | Supabase Free (1 GB Storage, 500 MB database), Vercel Hobby function limits |

## Actors
| Actor | Can reach | Wants |
|---|---|---|
| Anonymous visitor or bot | `/`, `POST /api/quote-requests`, `POST /api/quote-requests/{id}/submission`, Storage upload with the publishable key, the Supabase REST, Auth and Storage APIs directly (the URL and publishable key are in the page bundle), `/api/auth/sign-in`, `/api/health` | send spam, fill Storage, read other homeowners' data, take over a staff account |
| Malicious homeowner | the same, with a real browser and real timing | upload a non-image dressed as an image, put script text in fields, enrol someone else's email in GHL, change or read someone else's pending request |
| Signed-in non-staff user (should never exist: sign-up and anonymous sign-ins are off) | PostgREST with an `authenticated` token | read anything under `authenticated` grants |
| Staff (owner, helper) with a fresh session | `/api/*` with a bearer token and PostgREST directly with the same token | in scope: everything the matrix allows; abuse: skip the version check or the audit row by calling the database directly |
| Staff with a stolen or old session | the same token after 7 days, or after sign-out | keep reading data |
| Someone holding a leaked secret | whatever that secret opens | see Assets |
| A compromised or misbehaving GHL API | responses to our runner | inject values that our server stores or uses in later URLs |
| Agents on the dev team | the repository, Vercel previews, the staging database URL on the orchestrator machine | not malicious, but their standing access widens the blast radius (see S0 review, Pre-existing) |

## Trust boundaries
| Boundary | Who can reach it | Authenticates by | Authorises by (tenant, role) | Validates | May touch | Evidence |
|---|---|---|---|---|---|---|
| `GET /` (Request a quote page, issues the form token) | anyone | none | none | none | nothing stored; signs a token with `APP_SIGNING_SECRET`; rendered per request, `Cache-Control: private, no-store` | SECURITY_MODEL:11, 56-58; architecture:222, 224 |
| `POST /api/quote-requests` | anyone with a form token | `X-Form-Token` HMAC, 3 s to 24 h | single tenant; anonymous may only create a pending row | zod from `QuoteRequestCreate` (`additionalProperties: false`), honeypot `website`, then one `start_quote_request()` call: per-nonce lock, replay / update / 409 `form_already_used`, atomic 5-per-10-min slot per address (IPv6 /64) | service role: `start_quote_request()` (insert or update one pending row, insert `rate_limit_hits`), remove that request's uploaded files on `updated`, insert `spam_submission_blocked` | openapi.yaml:99-181; SECURITY_MODEL:12, 56-60, 80, 84; 20261120000600_functions.sql:42-155 |
| Storage upload `quote-photos/{request_id}/photo-N` | anyone with the publishable key | none (role `anon`) | `nq_quote_photos_insert_own_pending`: pending request, created in the last 60 min, planned position, at most 3 objects | bucket: 5,242,880 bytes, declared type JPEG/PNG/WebP; magic bytes and PNG/WebP dimensions re-checked at submit | insert one object, never overwrite or delete | 20261120000700_storage.sql:13-15, 23-67 |
| `POST /api/quote-requests/{id}/submission` | the holder of the token that created the request | same token, must equal `submission_key` | as above | each object's first bytes, size and dimensions (service role) | delete bad objects; `complete_quote_request()` (security invoker, service role only) | openapi.yaml `submitQuoteRequest`; 20261120000600_functions.sql:220-282 |
| `POST /api/auth/sign-in` | anyone | email and password through Supabase Auth | staff row required, otherwise signed out and 401 | zod `SignIn`; `take_sign_in_attempt()` before Auth (lock, count, record as failure), `mark_sign_in_succeeded()` after a staff sign-in; 503 when the signing secret is missing or short | `sign_in_attempts`, `staff_signed_in` event (service role) | SECURITY_MODEL:44-45, invariant 15; 20261120000600_functions.sql:164-214; openapi.yaml:509 |
| Staff `/api/*` | bearer token holders | `auth.getUser()` then `public.current_staff()` | `app_private.is_staff()`: staff row and JWT `session_id` naming an `auth.sessions` row younger than 7 days | zod per operation; `version` on writes; list and search only through `list_quote_requests` (typed parameters) | reads under RLS; writes only through the three staff RPCs | SECURITY_MODEL:14, 46-47, invariants 3-4; 20261120000200_staff.sql:29-62; 20261120000600_functions.sql:622-654 |
| PostgREST directly (publishable key, or a staff token) | anyone | JWT role | explicit table grants plus forced RLS; function `execute` grants | SQL types and check constraints | anon: nothing; staff: `select` and the staff RPCs, `list_quote_requests`, `weekly_counts` | revokes, grants and policies in migrations 0200 to 0600; `supabase/tests/rls/*`, `all_tables.sql` |
| Supabase Auth API directly | anyone | password, refresh token, recovery or OTP flows | sign-up off, anonymous sign-ins off (account-setup.md:80) | Supabase's own per-IP limits | sessions for existing users only | SECURITY_MODEL:17, 112, 114 |
| `GET /api/jobs/ghl-sync`, `GET /api/jobs/housekeeping` | anyone on the internet | `Authorization: Bearer CRON_SECRET`, constant-time compare of equal-length buffers; 401 while the secret is unset or under 32 characters | the secret only | none (no input) | claim one job per lease and settle it with that lease, GHL calls; purge stale pending rows, their files and counters | openapi.yaml:563 and housekeeping; SECURITY_MODEL invariants 12, 15 |
| Our server → GHL API | our runner only | Private Integration token | sub-account token, two scopes | n/a | four endpoints only (SECURITY_MODEL invariant 10); production base URL fixed (invariant 9) | integration-contract.md "Credentials and scopes" |
| GHL responses → our server | GHL (or anything at `GHL_API_BASE_URL` outside production) | TLS to the configured host | n/a | contact id `^[A-Za-z0-9_-]{1,100}$` in the runner and as a column check; `encodeURIComponent` before use | `quote_requests.ghl_contact_id`, later used in `/contacts/{id}/tags` URLs | 20261120000300_quote_requests.sql:55; SECURITY_MODEL:19, invariant 10 |
| Stored homeowner text → staff screens | staff | n/a | n/a | rendered as React text only (AC-001.5); nonce CSP backstop | staff browser DOM | SECURITY_MODEL invariants 13, 14 |
| Signed photo URLs → staff browser | staff (any holder of the URL for 900 s) | signed URL token | created with the staff member's own token through `nq_quote_photos_select_staff` (only objects recorded in `quote_photos`) | plain `<img>`, no `next/image` | image bytes, served from the Supabase domain with the stored image content type | SECURITY_MODEL invariants 6, 7; 20261120000700_storage.sql:74-81 |

## Threats per entry point and the control for each
"Holds" for a design-level control means the contract now requires it; the code does not exist yet and is checked in the Phase 4 review and QA probes.
| Entry point | Threat | Control | Holds? |
|---|---|---|---|
| `GET /` | the page is statically rendered or cached, so every visitor gets the same token and nonce | `await connection()` before `issueFormToken()`, `Cache-Control: private, no-store`, nothing static on `/` (SECURITY_MODEL:57; architecture:222, 224) | holds by contract (SEC-2 closed); QA checks the header on the preview |
| `GET /` | token harvesting: a bot fetches many pages, waits 3 s, posts | the token only proves a page load (SECURITY_MODEL:54); the rate limit is the real throttle | accepted by FR-8 and NG-2 |
| `POST /quote-requests` | spam that skips the checks by writing the table directly | anon has no privileges on any `public` table (0300:94; `all_tables.sql:32-36`); only the service role writes | holds |
| `POST /quote-requests` | rate limit beaten by parallel requests or IPv6 address rotation | `take_submission_slot()` locks, counts and records in one call inside `start_quote_request()` (0600:42-61, 127-143); IPv6 keyed by /64 (SECURITY_MODEL:84) | holds in SQL (SEC-3 closed); QA's 20-parallel probe proves it live |
| `POST /quote-requests` | the counter fails silently (hash in the wrong format, missing grant) and the limit is off with no signal | `start_quote_request()` swallows any counter error by design (AC-003.5) but reports nothing (0600:128-132) | Minor, SEC-21 |
| `POST /quote-requests` | two creates with one token race into two requests | per-nonce advisory lock (0600:100); unique `submission_key` backstop (0300:36) | holds; tested (`submission_and_limits.sql:13-26`) |
| `POST /quote-requests` | a used token takes different details (Back button) and merges them into the first request | `token_used` → 409 `form_already_used` (0600:113-115; openapi.yaml:181, 1328) | holds; tested (`submission_and_limits.sql:42-46`) |
| `POST /quote-requests` | a refusal reveals which check failed | honeypot and time trap share one 400 body | holds |
| `POST /quote-requests` | mass assignment of `state`, `reference`, `status`, `price_cents` | `additionalProperties: false` on `QuoteRequestCreate`; `start_quote_request()` takes named fields only | holds by contract |
| `POST /quote-requests` | cross-site request from a victim's browser to burn the victim's address quota | the custom `X-Form-Token` header forces a CORS preflight, and no CORS is allowed | holds while no CORS headers are added |
| `POST /quote-requests` | flood of refused submissions writes one `events` row each and grows the 500 MB database | none | Minor, SEC-14 (deferred to bl-pm) |
| Storage upload | a 4th photo, another name, another request's folder, a submitted or old request | `photo_upload_allowed()` (0700:23-60); tested in `tests/rls/storage_objects.sql:49-68` | holds |
| Storage upload | overwrite or delete an uploaded photo (swap the bytes after the server checked them) | no update or delete policy (0700:83-84; test line 41-43) | holds |
| Storage upload | a non-image declared as `image/jpeg` | bucket checks the declared type only; submit checks the first bytes and deletes failures (invariant 7) | holds by design |
| Storage upload | a polyglot (valid image header with HTML or script after it) | served from the Supabase domain, not ours, with an `image/*` content type; SVG and HTML types refused by the bucket | low residual risk |
| Storage upload | a decompression bomb crashes the staff browser; EXIF GPS kept | PNG/WebP over 12,000 px per side refused; plain `<img>`; EXIF accepted (invariant 7, SECURITY_MODEL:116) | holds by contract (SEC-16 fixed) |
| Storage upload | 1 GB Free storage filled with abandoned uploads | 15 MB per pending request, 5 per address (IPv6 /64) per 10 min enforced atomically, daily purge | accepted for distributed attacks only (SECURITY_MODEL:113) |
| `POST /submission` | complete someone else's pending request | the token must equal that request's `submission_key` | holds |
| `POST /submission` | double submit makes two requests or two references | `for update` and replay in `complete_quote_request` (0600:232-241) | holds |
| Reference numbers | guess an `NQ-` reference to read a request | no endpoint accepts a reference from anyone but staff (NG-3); 31^6 values from `gen_random_bytes` with rejection sampling (0300:12-32) | holds |
| Request ids | guess a pending request id to add photos | uuid v4, returned only to the token holder; accepted leak case (SECURITY_MODEL:117) | holds |
| `POST /auth/sign-in` | brute force, including parallel guesses | `take_sign_in_attempt()` records each attempt as a failure under a per-email lock before Auth (0600:164-199); direct Auth API calls skip it (accepted, SECURITY_MODEL:112) | holds within the accepted risk |
| `POST /auth/sign-in` | lock the owner out by failing 5 times every 15 min with her email | none; FR-9 requires the pause "even with the right password" | Minor, SEC-11 (deferred to bl-pm and Matthew at Gate 2) |
| Supabase Auth directly | password reset or magic link signs someone in although "no reset email" | no custom SMTP; documented rule (SECURITY_MODEL:114) | accepted and documented (SEC-10 fixed) |
| Supabase Auth directly | self sign-up or anonymous sign-in gives an `authenticated` token | both off (account-setup.md:80); without a staff row `is_staff()` is false everywhere | holds (live setting checked by A2) |
| Staff `/api/*` and PostgREST | read with a session older than 7 days or after sign-out | `is_staff()` session check (0200:29-44) | holds; tested |
| Staff RPCs | skip the version check, audit row or stage-tag job by writing tables directly | `authenticated` has `select` only (explicit grants); RPCs check `is_staff()` and `version` (0600:299-316, 361-375) | holds |
| Staff RPCs | `security definer` hijack through `search_path` | every function sets `search_path = ''` and qualifies every name | holds |
| Staff RPCs | a non-staff or anonymous caller | `revoke ... from public, anon`; `is_staff()` raises `PT401` | holds; tested |
| All tables | table owner or an owner-owned view or function reads without RLS | RLS enabled **and forced** on all 8 tables (0200:68, 0300:93/122/150, 0400:51, 0500:38/61/84); `all_tables.sql:20-24` covers future tables | holds in SQL (SEC-1 closed); live BYPASSRLS check at A2 |
| Server functions | a service-role function granted to another role by mistake skips RLS | the seven service-role functions are security invoker (0600:47, 88, 168, 205, 223, 462, 499; asserted `all_tables.sql:57-63`) | holds |
| Storage reads | staff see photos of pending, never-submitted requests | select policy requires a `quote_photos` row (0700:74-81); tested `storage_objects.sql:85-88` | holds (SEC-8 fixed) |
| `/api/jobs/*` | unset or empty `CRON_SECRET` turns into `Bearer undefined` and opens the route | invariants 12 and 15: unset or under 32 characters never matches | holds by contract (SEC-4 closed); QA probe |
| GHL runner | two runners do the same job (lease expires mid-batch), so the contact is created twice | `claim_ghl_job` leases one job with a fresh `lease_id` (0600:457-483); `finish_ghl_job` ignores a missing or stale lease (0600:520-522); supersede and manual retry clear the lease (0600:397-399, 437-441) | holds (SEC-7 closed); tested `complete_and_sync.sql:113-152` |
| GHL responses | a contact id with `/` or `..` steers later calls to other GHL paths | charset check in the runner and the column (0300:55) | holds (SEC-12 fixed) |
| GHL data flow | personal data enrolled in an email-marketing tool without consent, from addresses nobody verified | none yet; options recorded in integration-contract.md "Open questions" | **open, SEC-6 (Important), Matthew rules at Gate 2** |
| Logs | Postgres errors carry "Failing row contains (...)" with the homeowner's details | invariant 11 names error objects; `log.ts` allow-list; `http.ts` wrapper (architecture Observability) | holds by contract (SEC-5 closed); backend test forces a `23514` |
| Logs | search text (names, phones) in the request URL lands in Vercel's request logs | our logs never write the query string; platform log exposure accepted (SECURITY_MODEL:115) | accepted for Gate 2 (SEC-13) |
| PostgREST filters | filter syntax injected through `q` or the cursor | `list_quote_requests()` with typed parameters (0600:622-654) | holds (SEC-13 fixed) |
| `events` | personal data in `properties` | key allow-list check (0500:24-27) matching the metrics spec; tested `events.sql:18-19` | holds (SEC-9 fixed) |
| Staff browser | XSS steals the JS-readable session cookie | React text rendering only; nonce CSP with `strict-dynamic` (invariant 13) | holds by contract (SEC-15 fixed) |

## Personal data flows
| Data | Stored | Leaves the app to | Logged? |
|---|---|---|---|
| name, phone, email, address | `quote_requests` (ca-central-1) | GHL test sub-account (hosting location unverified, OQ-12; purpose open, SEC-6) | must not be; invariant 11 now covers DB errors; search URLs in platform logs accepted |
| problem text, price, note, urgency, reference | `quote_requests` | nowhere (integration-contract.md "Never sent") | must not be |
| photos (with EXIF) | Storage `quote-photos` | nowhere | n/a |
| network address | HMAC of `ip|v1|<address or /64>` in `rate_limit_hits`, 24 h | nowhere | our logs: no; Vercel platform request logs keep the client address (outside our control, short retention) |
| staff email | Supabase Auth; HMAC of `email|v1|...` in `sign_in_attempts`, 24 h | nowhere | no |
| staff user id | `events.user_id`, `events.properties.user_id`, audit rows | nowhere | yes (allowed: internal id) |

## Abuse cases (per Must story)
| Story | Attack | Blocked by | Gap |
|---|---|---|---|
| US-001 submit a request | Write `quote_requests` straight through PostgREST with the publishable key, skipping every spam check | anon has no table privileges; `all_tables.sql:32-36` | none |
| US-001 | Homeowner B loads a cached page with homeowner A's token | per-request rendering, `no-store` (contract) | none in the contract; QA proves on the preview |
| US-001 | Back button after a successful submit re-sends the same token with different details | fresh token after every completed submission (frontend); `token_used` → 409 in the database | none |
| US-001 | Script text in name or problem runs in the staff inbox | React text rendering only (AC-001.5, invariant 14); nonce CSP | none |
| US-002 attach photos | Upload an executable, HTML or SVG named `photo-1` | bucket type list plus first-bytes check at submit, bad files deleted | none by design; verify in code |
| US-002 | Upload a 4th file, or into another homeowner's folder | storage insert policy and unique object names | none |
| US-002 | Swap a checked photo for another file before `complete_quote_request` runs | no update or delete policy | none |
| US-002 | Fill the 1 GB bucket so real homeowners' uploads fail for up to 24 h | atomic per-address limit (IPv6 /64) and daily purge | distributed attack accepted |
| US-003 spam protection | 100 parallel creates from one address, each with its own harvested token | `take_submission_slot()` under a per-address lock | none in SQL; SEC-21 (silent fail-open) Minor |
| US-003 | Rotate through an IPv6 /64 | key on the /64 prefix | none (a /48 holder still gets 65,536 keys; accepted with distributed attacks) |
| US-003 | Hammer refused submissions to grow `events` | none | SEC-14 (deferred) |
| US-004 sign in | Guess passwords through our route, in parallel | `take_sign_in_attempt()` | none (direct Auth API path accepted) |
| US-004 | Lock the owner out with 5 wrong passwords every 15 minutes | none (FR-9 wording) | SEC-11 (deferred) |
| US-004 | Keep using a session older than 7 days, or one that was signed out | `is_staff()` session check in every policy and RPC | none |
| US-004 | Get any `authenticated` token (sign-up, anonymous, recovery or OTP) | sign-up and anonymous off; no staff row means nothing is readable; no custom SMTP (documented) | none |
| US-005 inbox and detail | Open a pending request by id | RLS `state = 'submitted'`; 404 per contract | none |
| US-005 | Open pending photos by guessing the path | select policy requires a `quote_photos` row | none |
| US-006 price and note | Overwrite a colleague's save | `version` check in `save_quote_request_quote` (0600:314-316) | none |
| US-006 | Set a price outside 0.01 to 99,999.99 | RPC check plus table check | none |
| US-007 status | Change status without an audit row or stage-tag job | no direct writes; `change_quote_request_status` writes all four in one transaction | none |
| US-008 weekly count | Read counts without a session | `weekly_counts` is security invoker; anon revoked; RLS limits non-staff to zero | none |
| US-016 board | Same as US-007 (drag uses the same RPC) | same | none |
| US-009/010/017 (Should) | Make our runner call GHL twice for one copy | one job per lease, lease id checked on settle | residual only if a single job outlives its 120 s lease (worst case is about 30 s); GHL duplicate search is the backstop |
| US-009 (Should) | Type a stranger's email so the stranger joins Northside's marketing list, or tag an existing contact | none | SEC-6 (Gate 2) |
| US-013 (Could) search | Inject PostgREST filter syntax through `q` or the cursor | typed `list_quote_requests` parameters; cursor validated before the call | none |

## Database review (SQL as written at `6f1372d`)
### RLS on every table
| Table | `enable` | `force` | Policies | anon | authenticated | service_role | Evidence |
|---|---|---|---|---|---|---|---|
| `staff` | yes | **yes** | select: `is_staff()` | revoked | select | select | 0200:67-76 |
| `quote_requests` | yes | **yes** | select: `is_staff()` and submitted | revoked | select | select, insert, update, delete | 0300:92-104 |
| `quote_photos` | yes | **yes** | select: `is_staff()` and parent submitted | revoked | select | select, insert, update, delete | 0300:121-133 |
| `quote_request_status_changes` | yes | **yes** | select: `is_staff()` | revoked | select | select | 0300:149-160 |
| `ghl_sync_jobs` | yes | **yes** | select: `is_staff()` | revoked | select | select, insert, update, delete | 0400:50-61 |
| `events` | yes | **yes** | select: `is_staff()` | revoked | select | select, insert | 0500:37-48 |
| `rate_limit_hits` | yes | **yes** | restrictive deny-all for anon, authenticated | revoked | revoked | select, insert, delete | 0500:60-70 |
| `sign_in_attempts` | yes | **yes** | restrictive deny-all for anon, authenticated | revoked | revoked | select, insert, update, delete | 0500:83-91 |
| `storage.objects` (bucket `quote-photos`) | Supabase-managed | Supabase-managed | insert: anon and authenticated through `photo_upload_allowed`; select: staff, only objects recorded in `quote_photos` | insert only | insert, select (staff) | Storage API | 0700:64-81 |

Every grant starts from `revoke all` (also removes Postgres 17's `MAINTAIN`). No table has a client write policy. Every write is the service role (through security invoker functions or the server) or a `security definer` staff RPC, so there is no child row whose parent is unchecked: the only client-written row is the Storage object, whose parent request is checked in `photo_upload_allowed` (0700:43-49). The application is single-tenant (one shop), so "tenant" checks reduce to "is a fresh staff session". The service-role grants cover every table the invoker functions write (checked function by function).

### Function inventory (who runs as whom)
| Function | Security | Caller check | `search_path` | Executable by | Evidence |
|---|---|---|---|---|---|
| `app_private.is_staff()` | definer (postgres) | is the check | `''` | authenticated, service_role | 0200:29-46 |
| `public.current_staff()` | definer (postgres) | `is_staff()` | `''` | authenticated, service_role | 0200:49-62 |
| `app_private.photo_upload_allowed` | definer (postgres) | is the check | `''` | anon, authenticated, service_role (schema not exposed over REST) | 0700:23-60 |
| `public.save_quote_request_quote` | definer (postgres) | `is_staff()`, version | `''` | authenticated, service_role | 0600:286-343 |
| `public.change_quote_request_status` | definer (postgres) | `is_staff()`, version | `''` | authenticated, service_role | 0600:349-414 |
| `public.request_ghl_copy_retry` | definer (postgres) | `is_staff()` | `''` | authenticated, service_role | 0600:421-450 |
| `public.take_submission_slot` | invoker | grants only | `''` | service_role | 0600:42-61 |
| `public.start_quote_request` | invoker | grants only | `''` | service_role | 0600:75-155 |
| `public.take_sign_in_attempt` | invoker | grants only | `''` | service_role | 0600:164-199 |
| `public.mark_sign_in_succeeded` | invoker | grants only | `''` | service_role | 0600:201-214 |
| `public.complete_quote_request` | invoker | grants only | `''` | service_role | 0600:220-282 |
| `public.claim_ghl_job` | invoker | grants only | `''` | service_role | 0600:457-483 |
| `public.finish_ghl_job` | invoker | grants only; lease id must match (0600:520-522) | `''` | service_role | 0600:495-612 |
| `public.list_quote_requests` | invoker | RLS | `''` | authenticated, service_role | 0600:622-654 |
| `public.weekly_counts`, `app_private.weekly_counts_at` | invoker | RLS | `''` | authenticated, service_role | 0600:661-697 |
| `app_private.new_reference`, `app_private.set_updated_at` | invoker | n/a | `''` | service_role (`new_reference`, 0600:35); trigger only | 0300:12-32; 0100:21-30 |

The definer functions rely on `postgres` having BYPASSRLS; the invoker service-role functions rely on `service_role` having it. Supabase documents both; `all_tables.sql:12-15` asserts both. If either is missing, the affected functions fail closed (error or no rows). pgTAP is no longer installed by any migration; each of the 14 test files installs it inside its own transaction and rolls back.

## Findings for the architect (status after the round 2 re-review)
Full entries with scenario, exact change, owner and closing evidence are in `.baseleap/reviews/S0.md`.
| ID | Sev | Finding | Status |
|---|---|---|---|
| SEC-1 | Critical | No `force row level security` on any of the 8 tables | **closed** in SQL; BYPASSRLS proven live at A2 |
| SEC-2 | Critical | Form-token page could be cached, so a shared nonce merged homeowners' requests | **closed** (contract and database); frontend and QA checks carried forward |
| SEC-3 | Important | Rate limit and sign-in pause were count-then-insert; IPv6 rotated freely | **closed** in SQL; QA parallel probes carried forward |
| SEC-4 | Important | Secrets were not required to fail closed when unset or short | **closed** (contract); code and QA probe carried forward |
| SEC-5 | Important | Database error details (the full failing row) could reach logs and responses | **closed** (contract); backend test carried forward |
| SEC-6 | Important | GHL copy puts unverified, non-consented contacts into an email-marketing tool | **open**, waiting for Matthew at Gate 2 |
| SEC-7 | Important | GHL job lease could expire mid-batch and `finish_ghl_job` accepted a stale runner | **closed** in SQL (`claim_ghl_job`, lease-checked `finish_ghl_job`) |
| SEC-8, 9, 10, 12, 13, 15 to 20 | Minor | see the review | fixed (SEC-13 URL logging accepted for Gate 2) |
| SEC-11, SEC-14 | Minor | sign-in lockout DoS; refusal-event growth | deferred, routed to bl-pm |
| SEC-21 | Minor (new, introduced by the fix) | counter errors are swallowed without any signal | open, non-blocking |

## Accepted risks (from SECURITY_MODEL) and this review's view
- **Direct Supabase Auth calls skip the per-email pause.** Agreed, given long generated passwords and sign-up off. Recorded here so nobody describes the pause as brute-force protection: it only covers our own route.
- **Abandoned uploads can fill 1 GB.** Agreed for a distributed attacker now that the limit is atomic and keyed by /64.
- **A leaked request id lets someone add photos for 60 minutes.** Agreed; the submit step re-checks every file.
- **Search text in Vercel's platform request logs (SEC-13).** Agreed for a Could story used by two staff; Matthew may reverse it at Gate 2.
- **Photo EXIF (SEC-16).** Agreed: staff-only, short-lived URLs, and the location is the typed address anyway.
- **Auth recovery and OTP endpoints (SEC-10).** Agreed while no custom SMTP is configured; the runbook rule is devops's.
- **GHL data location unverified (OQ-12).** Agreed for the test sub-account only. It blocks any real client, together with SEC-6.

## Live checks for A2 (read-only, on staging after the migrations run)
| Check | Query or screen | Safe answer |
|---|---|---|
| Owner and server roles bypass RLS (forced RLS leaves the functions working) | `select rolname, rolbypassrls from pg_roles where rolname in ('postgres', 'service_role');` (also `all_tables.sql:12-15`) | both `true`; if not, stop and raise a contract question, never drop `force` |
| Tables are owned by `postgres` | `all_tables.sql:16-18` | passes |
| `is_staff()` can read `auth.sessions` | run `tests/rls/staff.sql` | passes |
| RLS enabled and forced everywhere | `select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';` | every row `true, true` |
| anon holds no table privilege | `select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';` | no rows |
| authenticated holds `SELECT` only on the six readable tables | same query with `grantee = 'authenticated'` | `SELECT` only, never on `rate_limit_hits` or `sign_in_attempts` |
| No `public` function executable by anon | `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');` | no rows (a Supabase-owned function here would fail `all_tables.sql`; investigate, don't widen) |
| Service-role functions are invoker | `select proname, prosecdef from pg_proc where proname in ('start_quote_request','take_submission_slot','take_sign_in_attempt','mark_sign_in_succeeded','complete_quote_request','claim_ghl_job','finish_ghl_job');` | `prosecdef` false on all seven |
| pgTAP absent outside tests | `select extname from pg_extension where extname = 'pgtap';` (outside a test transaction) | no rows |
| Function tests pass under forced RLS | `npm run db:test` (all of `supabase/tests/functions/*.sql`) | every file passes |
| Bucket private with limits | `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'quote-photos';` | `false`, 5242880, the three image types |
| Sign-up and anonymous sign-ins off | Authentication → Sign In / Providers | both off |
| No mail sender | Authentication → Emails → SMTP settings | default sender (team-only delivery), no custom SMTP |
