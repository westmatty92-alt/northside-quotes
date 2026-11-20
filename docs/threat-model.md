# Threat model: Northside quote requests (2026-11-19, step S0; updated 2026-11-20 for PRD v1.2)

**Author:** bl-security · **Reviewed:** the A1 blueprint at `23c6744` (round 1), the architect's S0 fixes at `6f1372d` (round 2), and A1 Pass 3 for PRD v1.2 at `efcee08` (round 3: consent 1B, one contact per homeowner 2A, staff passwords 3A, sign-in limits 4A, the SEC-14 event cap, `rejected`, tabs). No application code exists yet. · **Verdict and routable directives:** `.baseleap/reviews/S0.md`
**Read in full (round 1):** `docs/PRD.md` (requirements, non-goals, open questions), `docs/architecture.md`, `docs/SECURITY_MODEL.md`, `docs/openapi.yaml`, `docs/integration-contract.md`, `docs/decisions/0001` to `0004`, all seven files in `supabase/migrations/`, all twelve files then in `supabase/tests/`. **Grepped:** `docs/user-stories.md` (AC-003, AC-004, GHL role), `docs/metrics-spec.md` (event properties), `docs/design-specs.md` (consent), `docs/ops/account-setup.md` (Auth settings, secret rows), `.env.example` (names only).
**Round 2:** every migration and `docs/SECURITY_MODEL.md` re-read in full at `6f1372d`; `supabase/tests/rls/all_tables.sql`, `storage_objects.sql`, `events.sql`, `supabase/tests/functions/submission_and_limits.sql` and `complete_and_sync.sql` read in full; the `docs/architecture.md`, `docs/openapi.yaml` and `docs/integration-contract.md` diffs read in full.
**Round 3 (`efcee08`):** read in full: `supabase/migrations/20261120000600_functions.sql`, `docs/SECURITY_MODEL.md`, `supabase/tests/rls/all_tables.sql`, and the spam and sign-in parts of `supabase/tests/functions/submission_and_limits.sql` (lines 100-214). Read as diffs: migrations 0300, 0400 and 0500. Grepped: `docs/openapi.yaml` (sign-in, consent, retry), `docs/integration-contract.md` (match rule, 400/404/422, Conflicts, handoff), `docs/architecture.md` (routes, build requirements, A2 checks), `docs/PRD.md` (FR-1, FR-8, FR-9, FR-15, FR-25 to FR-27, the 2026-11-20 rulings), `docs/design-specs.md` (offers box), the assertions in the new and changed test files.
**Not run yet:** none of the migrations has run on a database. A2 applies them to staging for the first time, in parallel with this review. Every statement below about database behaviour comes from reading the SQL. The checks that need a live database are listed under "Live checks for A2".

Line references below are to the files at `efcee08`. `0600` stands for `supabase/migrations/20261120000600_functions.sql`, and the other migrations are abbreviated the same way.

## Assets
| Asset | Why an attacker wants it | Where it lives |
|---|---|---|
| Homeowner personal data: name, phone, email, home address, problem text | identity theft, a target list ("this house has a burst pipe and an emergency"), selling leads to a competitor | `public.quote_requests` (ca-central-1); name, phone, email and address of **consented** homeowners also in the GHL test sub-account, one contact per homeowner (2A) |
| Offers consent and its time | forging consent puts a stranger on a marketing list; erasing it breaks the CASL record | `quote_requests.marketing_consent`, `marketing_consent_at` (immutable once stored, 0300:120-137) |
| Photos of the inside of homes (may carry EXIF GPS) | burglary reconnaissance, privacy harm | private Storage bucket `quote-photos` |
| Staff powers: change price, note or status, re-arm a GHL copy | sabotage the pipeline (mark every lead Lost), wreck the metrics | `security definer` RPCs gated by `app_private.is_staff()` |
| Staff sessions (Supabase access and refresh tokens) | all of the above for up to 7 days | `sb-*-auth-token` cookies, readable by JavaScript by design (`httpOnly` false) |
| Staff passwords | a lasting way in that outlives any session | Supabase Auth; set and reset by Baseleap in the dashboard only (3A) |
| `SUPABASE_SERVICE_ROLE_KEY` | read and write every table, bypassing RLS | Vercel env (Sensitive), read only in `src/lib/server/admin.ts` |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | read and write every contact in the sub-account (`contacts.readonly`, `contacts.write`) | Vercel env (Sensitive), read only in `src/lib/server/integrations/ghl/client.ts` |
| `APP_SIGNING_SECRET` | forge form tokens (skip the 3-second trap), turn the IP and email HMACs back into addresses | Vercel env (Sensitive), read only in `src/lib/server/env.ts` |
| `CRON_SECRET` | trigger the job routes whenever wanted | Vercel env (Sensitive), read only in `src/lib/server/env.ts` |
| Integrity of the record | fake leads, forged audit rows, a second GHL contact for one request, the wrong stage tag on a real homeowner's contact | `quote_requests`, `quote_request_status_changes`, `ghl_sync_jobs`, GHL contact tags |
| Availability at $0 | stop real homeowners from sending requests, or keep the owner signed out | Supabase Free (1 GB Storage, 500 MB database), Vercel Hobby function limits, the sign-in pauses |

## Actors
| Actor | Can reach | Wants |
|---|---|---|
| Anonymous visitor or bot | `/`, `POST /api/quote-requests`, `POST /api/quote-requests/{id}/submission`, Storage upload with the publishable key, the Supabase REST, Auth and Storage APIs directly (the URL and publishable key are in the page bundle), `/api/auth/sign-in`, `/sign-in?next=`, `/api/health` | send spam, fill Storage or the database, read other homeowners' data, take over or lock out a staff account |
| Malicious homeowner | the same, with a real browser and real timing | upload a non-image dressed as an image, put script text in fields, tick the offers box for someone else's email or phone, link a request to someone else's GHL contact (2A), change or read someone else's pending request |
| Signed-in non-staff user (should never exist: sign-up and anonymous sign-ins are off) | PostgREST with an `authenticated` token | read anything under `authenticated` grants |
| Staff (owner, helper) with a fresh session | `/api/*` with a bearer token, PostgREST directly with the same token, Supabase Auth `PUT /auth/v1/user` with her own session | in scope: everything the matrix allows; abuse: skip the version check or the audit row by calling the database directly |
| Staff with a stolen or old session | the same token after 7 days, or after sign-out | keep reading data; change the password to keep access |
| Someone sharing a network address with staff (office, carrier NAT) | `/api/auth/sign-in` from the same address | deliberately or not, pause that address for 15 minutes |
| Someone holding a leaked secret | whatever that secret opens | see Assets |
| A compromised or misbehaving GHL API | responses to our runner | inject values that our server stores or uses in later URLs |
| Agents on the dev team | the repository, Vercel previews, the staging database URL on the orchestrator machine | not malicious, but their standing access widens the blast radius (see S0 review, Pre-existing) |

## Trust boundaries
| Boundary | Who can reach it | Authenticates by | Authorises by (tenant, role) | Validates | May touch | Evidence |
|---|---|---|---|---|---|---|
| `GET /` (Request a quote page, issues the form token) | anyone | none | none | none | nothing stored; signs a token with `APP_SIGNING_SECRET`; rendered per request, `Cache-Control: private, no-store` | SECURITY_MODEL:11, 63-67; architecture:267, 269 |
| `POST /api/quote-requests` | anyone with a form token | `X-Form-Token` HMAC, 3 s to 24 h | single tenant; anonymous may only create a pending row | zod from `QuoteRequestCreate` (`additionalProperties: false`), honeypot `website`; `marketing_consent` coerced with `value === true`, never validated (openapi:1071-1079); then one `start_quote_request()` call: per-nonce lock, field comparison including consent, replay / update / 409 `form_already_used`, atomic 5-per-10-min slot per address (IPv6 /64) | service role: `start_quote_request()` (insert or update one pending row, insert `rate_limit_hits`), remove that request's uploaded files on `updated`; refusals through `record_spam_refusal()` only | openapi:99-181; SECURITY_MODEL:12, 63-67, invariants 16, 18, 20; 0600:81-167, 180-230 |
| Storage upload `quote-photos/{request_id}/photo-N` | anyone with the publishable key | none (role `anon`) | `nq_quote_photos_insert_own_pending`: pending request, created in the last 60 min, planned position, at most 3 objects | bucket: 5,242,880 bytes, declared type JPEG/PNG/WebP; magic bytes and PNG/WebP dimensions re-checked at submit | insert one object, never overwrite or delete | 0700:13-15, 23-67 |
| `POST /api/quote-requests/{id}/submission` | the holder of the token that created the request | same token, must equal `submission_key` | as above | each object's first bytes, size and dimensions (service role) | delete bad objects; `complete_quote_request()` (security invoker, service role only): sets the consent time and queues a copy job **only with consent** | openapi `submitQuoteRequest`; 0600:370-436 (consent 410, 421-423) |
| `POST /api/auth/sign-in` | anyone | email and password through Supabase Auth | staff row required, otherwise signed out and 401 | zod `SignIn`; `take_sign_in_attempt(email_hash, ip_hash)` before Auth: lock email then address, check both pauses, record the attempt as a failure; `allowed: false` → 429 `sign_in_paused` with one body and no `Retry-After`; any error → 503 `sign_in_unavailable`, Auth not called; `mark_sign_in_succeeded()` after a staff sign-in | `sign_in_attempts`, `sign_in_pauses`, `staff_signed_in` event (service role) | SECURITY_MODEL:16, 49-51, invariants 16, 19; 0600:243-361; openapi:528-589, 1509-1537 |
| `/sign-in?next=<path>` (return to the tab opened) | anyone | none | none | `next` followed only when it matches `^/(requests|pipeline)(/[0-9a-f-]{36})?$`, else `/requests` | the browser's next location (same origin only) | SECURITY_MODEL:17, 52, invariant 22; architecture:74, 81, 283 |
| Staff `/api/*` (Requests and Pipeline tabs, detail under each) | bearer token holders | `auth.getUser()` then `public.current_staff()` | `app_private.is_staff()`: staff row and JWT `session_id` naming an `auth.sessions` row younger than 7 days | zod per operation; `version` on writes; list and search only through `list_quote_requests` (typed parameters) | reads under RLS; writes only through the three staff RPCs | SECURITY_MODEL:14, 53-54, invariants 3-4; 0200:29-62; 0600:853-885 |
| PostgREST directly (publishable key, or a staff token) | anyone | JWT role | explicit table grants plus forced RLS; function `execute` grants | SQL types and check constraints | anon: nothing; staff: `select` and the staff RPCs, `list_quote_requests`, `weekly_counts` | revokes, grants and policies in migrations 0200 to 0600; `supabase/tests/rls/*`, `all_tables.sql` |
| Supabase Auth API directly | anyone (and a signed-in staff member with her own session) | password, refresh token, recovery or OTP flows; `PUT /auth/v1/user` | sign-up off, anonymous sign-ins off (account-setup.md:80) | Supabase's own per-IP limits; minimum password length 12 and reauthentication on (devops) | sessions for existing users only; her own password | SECURITY_MODEL:19, 48, 131, 133, 136 |
| `GET /api/jobs/ghl-sync`, `GET /api/jobs/housekeeping` | anyone on the internet | `Authorization: Bearer CRON_SECRET`, constant-time compare of equal-length buffers; 401 while the secret is unset or under 32 characters | the secret only | none (no input) | claim one job per lease and settle it with that lease, GHL calls; purge stale pending rows, their files and the four counter tables | openapi `runGhlSyncJobs` and housekeeping; SECURITY_MODEL invariants 12, 15 |
| Our server → GHL API | our runner only | Private Integration token | sub-account token, two scopes | jobs exist only for consented requests (trigger 0400:56-72) | four endpoints only (invariant 10); production base URL fixed (invariant 9); after creation only tags change, never contact fields (OQ-19A) | integration-contract.md:5, 38, 40-46, "Credentials and scopes" |
| GHL responses → our server | GHL (or anything at `GHL_API_BASE_URL` outside production) | TLS to the configured host | n/a | contact id `^[A-Za-z0-9_-]{1,100}$` in the runner and as a column check; `encodeURIComponent` before use; 400/404/422 → `rejected`, never retried; response bodies never parsed for ids on a 400 (one more duplicate search instead) | `quote_requests.ghl_contact_id`, later used in `/contacts/{id}/tags` URLs | 0300:58; integration-contract.md:35, 84-86; SECURITY_MODEL:21, invariant 10 |
| Stored homeowner text → staff screens | staff | n/a | n/a | rendered as React text only (AC-001.5); nonce CSP backstop | staff browser DOM | SECURITY_MODEL invariants 13, 14 |
| Signed photo URLs → staff browser | staff (any holder of the URL for 900 s) | signed URL token | created with the staff member's own token through `nq_quote_photos_select_staff` (only objects recorded in `quote_photos`) | plain `<img>`, no `next/image` | image bytes, served from the Supabase domain with the stored image content type | SECURITY_MODEL invariants 6, 7; 0700:75-81 |

## Threats per entry point and the control for each
"Holds" for a design-level control means the contract now requires it. The code does not exist yet; it is checked in the Phase 4 review and by the QA probes.
| Entry point | Threat | Control | Holds? |
|---|---|---|---|
| `GET /` | the page is statically rendered or cached, so every visitor gets the same token and nonce | `await connection()` before `issueFormToken()`, `Cache-Control: private, no-store`, nothing static on `/` (SECURITY_MODEL:64; architecture:267, 269) | holds by contract (SEC-2 closed); QA checks the header on the preview |
| `GET /` | token harvesting: a bot fetches many pages, waits 3 s, posts | the token only proves a page load (SECURITY_MODEL:61); the rate limit is the real throttle | accepted by FR-8 and NG-2 |
| `POST /quote-requests` | spam that skips the checks by writing the table directly | anon has no privileges on any `public` table (0300:143; `all_tables.sql:32-36`); only the service role writes | holds |
| `POST /quote-requests` | rate limit beaten by parallel requests or IPv6 address rotation | `take_submission_slot()` locks, counts and records in one call inside `start_quote_request()` (0600:45-64, 137-153); IPv6 keyed by /64 (SECURITY_MODEL:96) | holds in SQL (SEC-3 closed); QA's 20-parallel probe proves it live |
| `POST /quote-requests` | the counter fails silently (hash in the wrong format, missing grant) and the limit is off with no signal | `start_quote_request()` swallows any counter error by design (AC-003.5) and reports nothing (0600:138-142) | Minor, SEC-21 (open, unchanged in round 3) |
| `POST /quote-requests` | two creates with one token race into two requests | per-nonce advisory lock (0600:108); unique `submission_key` backstop (0300:39) | holds; tested |
| `POST /quote-requests` | a used token takes different details (Back button), including a flipped offers box, and merges them into the first request | the comparison includes `marketing_consent` (0600:113-116); `token_used` → 409 `form_already_used` (0600:122-124) | holds; tested (`submission_and_limits.sql`) |
| `POST /quote-requests` | a crafted body sets consent with `"true"`, `1` or `"yes"` and passes as a yes, or a non-boolean causes a 500 | the route coerces with `value === true`; the function stores `coalesce(p, false)` (0600:102); the column is `not null default false` (0300:60) | holds by contract; QA posts `"maybe"` (architecture:287) |
| `POST /quote-requests` | a refusal reveals which check failed | honeypot and time trap share one 400 body; `record_spam_refusal()` changes logging only, never the response (0600:176-178) | holds |
| `POST /quote-requests` | mass assignment of `state`, `reference`, `status`, `price_cents`, `marketing_consent_at`, `ghl_contact_id` | `additionalProperties: false` on `QuoteRequestCreate`; `start_quote_request()` takes named fields only; the consent time is set only by `complete_quote_request()` (0600:410) | holds by contract |
| `POST /quote-requests` | cross-site request from a victim's browser to burn the victim's address quota | the custom `X-Form-Token` header forces a CORS preflight, and no CORS is allowed | holds while no CORS headers are added |
| `POST /quote-requests` | a flood of refused submissions writes one `events` row each and grows the 500 MB database | `record_spam_refusal()`: one event and one window row per address and reason per 10 minutes, with `count`; a new event only while fewer than 1,000 exist for the Hamilton day, checked under one global lock; nothing written past the cap (0600:180-230; 0500:85-109) | **holds in SQL (SEC-14 closed)**; worst case about 1,000 event rows a day are kept (windows are purged after 24 h); tested `submission_and_limits.sql:104-141` |
| `POST /quote-requests` | an attacker exhausts the daily cap so later real refusals go unlogged | none needed: refusals still happen; the blocked share reads low on that day | accepted (FR-8, SECURITY_MODEL:143) |
| Storage upload | a 4th photo, another name, another request's folder, a submitted or old request | `photo_upload_allowed()` (0700:23-60); tested in `tests/rls/storage_objects.sql` | holds |
| Storage upload | overwrite or delete an uploaded photo (swap the bytes after the server checked them) | no update or delete policy (0700) | holds |
| Storage upload | a non-image declared as `image/jpeg` | the bucket checks the declared type only; submit checks the first bytes and deletes failures (invariant 7) | holds by design |
| Storage upload | a polyglot (valid image header with HTML or script after it) | served from the Supabase domain, not ours, with an `image/*` content type; SVG and HTML types refused by the bucket | low residual risk |
| Storage upload | a decompression bomb crashes the staff browser; EXIF GPS kept | PNG/WebP over 12,000 px per side refused; plain `<img>`; EXIF accepted (invariant 7, SECURITY_MODEL:138) | holds by contract (SEC-16 fixed) |
| Storage upload | 1 GB Free storage filled with abandoned uploads | 15 MB per pending request, 5 per address (IPv6 /64) per 10 min enforced atomically, daily purge | accepted for distributed attacks only (SECURITY_MODEL:135) |
| `POST /submission` | complete someone else's pending request | the token must equal that request's `submission_key` | holds |
| `POST /submission` | double submit makes two requests, two references or two copy jobs | `for update` and replay in `complete_quote_request` (0600:382, 387-391); unique `(request_id)` for `contact_copy` | holds |
| `POST /submission` and staff status changes | a GHL job is queued for a request without consent (bug, by-hand insert, a new code path) | the RPCs queue only when `marketing_consent` (0600:421-423, 551-559); trigger `ghl_sync_jobs_require_consent` refuses any insert for an unticked request, for every role (0400:56-72); `quote_requests_link_needs_consent` refuses a contact id on an unticked request (0300:71-72) | **holds for inserts (SEC-6 closed)**; tested `complete_and_sync.sql:30-31`, `rls/ghl_sync_jobs.sql:28-34`. The trigger does not fire on `update`, and `service_role` may update `request_id`: Minor SEC-23 |
| Stored request | consent or its time edited after submission (forging or erasing the record) | trigger `quote_requests_consent_immutable` refuses any change once `state = 'submitted'`, for every role (0300:120-137); time without consent and consent without time refused by checks (0300:67-70) | holds; tested (`submission_and_limits.sql`) |
| Reference numbers | guess an `NQ-` reference to read a request | no endpoint accepts a reference from anyone but staff (NG-3); 31^6 values from `gen_random_bytes` with rejection sampling (0300:15-35) | holds |
| Request ids | guess a pending request id to add photos | uuid v4, returned only to the token holder; accepted leak case (SECURITY_MODEL:139) | holds |
| `POST /auth/sign-in` | brute force, including parallel guesses, across many emails | `take_sign_in_attempt()` records each attempt as a failure under a per-email then per-address lock before Auth (0600:326-342): 5 per email per 15 min, 20 per address (/64) per 15 min; refused attempts not counted; direct Auth API calls skip it (accepted, SECURITY_MODEL:131) | holds in SQL; tested `submission_and_limits.sql:143-203` (sequential: pgTAP has one connection); QA's parallel probe proves it live |
| `POST /auth/sign-in` | two concurrent calls deadlock on the two locks | every call takes the email lock, then the address lock (0600:326-327); the two key spaces have different prefixes | holds |
| `POST /auth/sign-in` | the 429 tells an attacker which limit applied, or whether the email has an account | one body for both limits, no `Retry-After` (openapi:1509-1523); unknown emails hashed and counted the same way (tested `submission_and_limits.sql:180-182`); `retry_after_seconds` is server-only (0600:308-309) | holds by contract; QA checks the header |
| `POST /auth/sign-in` | the counters fail and sign-in proceeds without limits | the function never swallows an error; any error → 503 `sign_in_unavailable`, Auth not called (SECURITY_MODEL:51, invariant 19) | holds by contract; backend test forces a database error (architecture:282) |
| `POST /auth/sign-in` | lock the owner out by failing 5 times per 5-minute pause with her email; pause a shared address | none by design: FR-9 refuses even with the right password | **accepted by ruling 4A (SEC-11 closed)**: PRD FR-9, PRD:207, SECURITY_MODEL:132 |
| `POST /auth/sign-in` | split one account over several email keys with Unicode look-alikes that our lower-casing and Supabase Auth's treat differently | the per-address limit caps the total per address regardless of email key | needs verification in Phase 4 (hash input normalisation) |
| `/sign-in?next=` | open redirect to a phishing page after a real sign-in | anchored allow-list of invariant 22; anything else lands on `/requests` | holds by contract (`//host`, `/\host`, absolute URLs, `%2F` and newlines all fail the pattern); Phase 4 and QA cases |
| Password change or reset | an in-app or emailed reset lets someone set a staff password | no page, link, route, database function or email (3A, invariant 21); `all_tables.sql:75-79` asserts the database half; no custom SMTP (SEC-10) | database half holds; app half checked in Phase 4 (no route, no `resetPasswordForEmail` or `updateUser({ password })` call) |
| Supabase Auth directly | a signed-in staff member (or a thief with her session) changes the password through `PUT /auth/v1/user` | reauthentication on (a session older than 24 h needs an emailed nonce that is never delivered); the 7-day session limit | accepted (SECURITY_MODEL:133): a session younger than 24 h can still do it |
| Supabase Auth directly | password reset or magic link signs someone in although "no reset email" | no custom SMTP; documented rule (SECURITY_MODEL:136) | accepted and documented (SEC-10 fixed) |
| Supabase Auth directly | self sign-up or anonymous sign-in gives an `authenticated` token | both off (account-setup.md:80); without a staff row `is_staff()` is false everywhere | holds (live setting checked by A2) |
| Staff `/api/*` and PostgREST | read with a session older than 7 days or after sign-out | `is_staff()` session check (0200:29-46) | holds; tested |
| Staff RPCs | skip the version check, audit row or stage-tag job by writing tables directly | `authenticated` has `select` only (explicit grants); RPCs check `is_staff()` and `version` (0600:453, 468-470, 516, 528-530) | holds |
| Staff RPCs | re-arm a GHL copy for an unticked request | `request_ghl_copy_retry` raises PT409 after `is_staff()` and the 404 check, before any update (0600:589-599) | holds; tested `status_and_quote.sql:67-75` |
| Staff RPCs | `security definer` hijack through `search_path` | every function, including the two trigger functions and `sign_in_pause_until`, sets `search_path = ''` and qualifies every name | holds |
| Staff RPCs | a non-staff or anonymous caller | `revoke ... from public, anon`; `is_staff()` raises `PT401` | holds; tested |
| All tables | table owner or an owner-owned view or function reads without RLS | RLS enabled **and forced** on all 10 tables (see "RLS on every table"); `all_tables.sql:20-24` covers future tables | holds in SQL (SEC-1 closed); live BYPASSRLS check at A2 |
| Server functions | a service-role function granted to another role by mistake skips RLS | the ten service-role functions are security invoker (asserted `all_tables.sql:57-64`) and not executable by `authenticated` (`:66-73`) | holds |
| `events` | a server bug rewrites an event's name, time or request link | `service_role` may update only the `properties` column (0500:49); the key allow-list still applies on update (0500:29-31); tested `rls/spam_refusal_windows.sql:47` | holds |
| Storage reads | staff see photos of pending, never-submitted requests | select policy requires a `quote_photos` row (0700:75-81) | holds (SEC-8 fixed) |
| `/api/jobs/*` | unset or empty `CRON_SECRET` turns into `Bearer undefined` and opens the route | invariants 12 and 15: unset or under 32 characters never matches | holds by contract (SEC-4 closed); QA probe |
| GHL runner | two runners do the same job (lease expires mid-batch), so the contact is created twice | `claim_ghl_job` leases one job with a fresh `lease_id` (0600:621-647); `finish_ghl_job` ignores a missing or stale lease (0600:692-694); supersede and manual retry clear the lease (0600:553-555, 601-603) | holds (SEC-7 closed) |
| GHL runner | a refused payload or a deleted contact is retried for 22 hours | `rejected` (400, 404, 422) fails at once whatever outcome the runner passes (0600:681-683); 400 on create → one more duplicate search, then link or `rejected` (integration-contract.md:84-86) | holds; tested `complete_and_sync.sql:187-198` |
| GHL contact match (2A) | a stranger's ticked request with a homeowner's email or phone is linked to her contact and, by "last change wins", sets her stage tag; or a stranger creates the contact first and her later request links to the stranger's name and phone | match on email **or** phone (0600:796-815); last change wins (0600:824-842); linking sends tags only, never contact fields (integration-contract.md:38, 46); nothing from the match is returned to the submitter (the copy runs after the response) | no homeowner data reaches the attacker through our app; integrity residual: Minor SEC-22 |
| GHL data flow | personal data enrolled in an email-marketing tool without consent | 1B: copy and stage tags only for ticked requests (see the consent rows above) | **closed (SEC-6)**; residual: a tick is the homeowner's word (SECURITY_MODEL:134, OQ-16) |
| GHL data flow | consent is for **email** offers, but the phone is copied too and GHL can text it | none in the contract yet | Minor SEC-24 |
| GHL responses | a contact id with `/` or `..` steers later calls to other GHL paths | charset check in the runner and the column (0300:58) | holds (SEC-12 fixed) |
| Logs | Postgres errors carry "Failing row contains (...)" with the homeowner's details; GHL 400 bodies echo the payload | invariant 11 names database and provider errors; `log.ts` allow-list; `http.ts` wrapper (architecture Observability) | holds by contract (SEC-5 closed); backend test forces a `23514` |
| Logs | search text (names, phones) in the request URL lands in Vercel's request logs | our logs never write the query string; platform log exposure accepted (SECURITY_MODEL:137) | accepted for Gate 2 (SEC-13) |
| PostgREST filters | filter syntax injected through `q` or the cursor | `list_quote_requests()` with typed parameters (0600:853-885) | holds (SEC-13 fixed) |
| `events` | personal data in `properties` | key allow-list check (0500:29-31) matching the metrics spec, now with `marketing_consent` (boolean) and `count` (integer); the address key never goes into `events` (tested `submission_and_limits.sql:112-115`) | holds (SEC-9 fixed) |
| Staff browser | XSS steals the JS-readable session cookie | React text rendering only; nonce CSP with `strict-dynamic` (invariant 13) | holds by contract (SEC-15 fixed) |

## Personal data flows
| Data | Stored | Leaves the app to | Logged? |
|---|---|---|---|
| name, phone, email, address | `quote_requests` (ca-central-1) | GHL test sub-account, **only for ticked requests**, one contact per homeowner; fields sent only when a contact is created, never on a link (hosting location unverified, OQ-12) | must not be; invariant 11 covers DB and provider errors; search URLs in platform logs accepted |
| offers consent (yes or no) and its time | `quote_requests`; `marketing_consent` boolean on the `quote_request_submitted` event | nowhere (the consent itself is never sent; integration-contract.md:18) | as a boolean on one event only |
| problem text, price, note, urgency, reference | `quote_requests` | nowhere (integration-contract.md:38) | must not be |
| photos (with EXIF) | Storage `quote-photos` | nowhere | n/a |
| network address | HMAC of `ip|v1|<address, /64 or unknown>` in `rate_limit_hits`, `spam_refusal_windows`, `sign_in_attempts`, `sign_in_pauses`, 24 h | nowhere | our logs: no; never in `events`; Vercel platform request logs keep the client address (outside our control, short retention) |
| staff email | Supabase Auth; HMAC of `email|v1|...` in `sign_in_attempts` and `sign_in_pauses`, 24 h | nowhere | no |
| staff user id | `events.user_id`, `events.properties.user_id`, audit rows | nowhere | yes (allowed: internal id) |

## Abuse cases (per Must story)
| Story | Attack | Blocked by | Gap |
|---|---|---|---|
| US-001 submit a request | Write `quote_requests` straight through PostgREST with the publishable key, skipping every spam check | anon has no table privileges; `all_tables.sql:32-36` | none |
| US-001 | Homeowner B loads a cached page with homeowner A's token | per-request rendering, `no-store` (contract) | none in the contract; QA proves on the preview |
| US-001 | Back button after a successful submit re-sends the same token with different details or a flipped offers box | fresh token after every completed submission (frontend); comparison includes consent; `token_used` → 409 in the database | none |
| US-001 (1B) | Send `"marketing_consent": "true"` or `1` to tick the box for someone without the UI | only a JSON `true` is yes; that is also what the UI sends, so a script can still send `true` | none beyond the accepted "a tick is the homeowner's word" (OQ-16) |
| US-001 | Script text in name or problem runs in the staff screens | React text rendering only (AC-001.5, invariant 14); nonce CSP | none |
| US-002 attach photos | Upload an executable, HTML or SVG named `photo-1` | bucket type list plus first-bytes check at submit, bad files deleted | none by design; verify in code |
| US-002 | Upload a 4th file, or into another homeowner's folder | storage insert policy and unique object names | none |
| US-002 | Swap a checked photo for another file before `complete_quote_request` runs | no update or delete policy | none |
| US-002 | Fill the 1 GB bucket so real homeowners' uploads fail for up to 24 h | atomic per-address limit (IPv6 /64) and daily purge | distributed attack accepted |
| US-003 spam protection | 100 parallel creates from one address, each with its own harvested token | `take_submission_slot()` under a per-address lock | none in SQL; SEC-21 (silent fail-open) Minor |
| US-003 | Rotate through an IPv6 /64 | key on the /64 prefix | none (a /48 holder still gets 65,536 keys; accepted with distributed attacks) |
| US-003 | Hammer refused submissions from one or many addresses to grow `events` | `record_spam_refusal()` cap: one event per address and reason per 10 min, 1,000 a day, nothing past the cap | none (SEC-14 closed); at most about 1,000 rows a day kept |
| US-004 sign in | Guess passwords through our route, in parallel, over many emails | `take_sign_in_attempt()`: 5 per email, 20 per address per 15 min | none for our route; the direct Auth API path is accepted |
| US-004 | Lock the owner out with 5 wrong passwords per pause | none by design | accepted by ruling 4A (SEC-11 closed) |
| US-004 | Learn which limit applied or whether an email has an account | one 429 body, no `Retry-After`, unknown emails counted the same | none by contract; QA checks the header |
| US-004 | Make the counters fail so sign-in runs without limits | 503 on any error, Auth not called | none by contract; backend test |
| US-004 / FR-26 | Send the owner a real sign-in link with `next=//evil.example` so she lands on a phishing copy after signing in | invariant 22 allow-list | none by contract; Phase 4 and QA |
| US-004 / FR-27 | Find a forgot-password or change-password path in the app | none exists (3A); database half asserted | app half checked in Phase 4 |
| US-004 | Keep using a session older than 7 days, or one that was signed out | `is_staff()` session check in every policy and RPC | none |
| US-004 | Get any `authenticated` token (sign-up, anonymous, recovery or OTP) | sign-up and anonymous off; no staff row means nothing is readable; no custom SMTP (documented) | none |
| US-005 Requests tab and detail | Open a pending request by id, under either tab path | RLS `state = 'submitted'`; 404 per contract; both detail paths use `getQuoteRequest` | none |
| US-005 | Open pending photos by guessing the path | select policy requires a `quote_photos` row | none |
| US-006 price and note | Overwrite a colleague's save | `version` check in `save_quote_request_quote` (0600:468-470) | none |
| US-006 | Set a price outside 0.01 to 99,999.99 | RPC check plus table check | none |
| US-007 status | Change status without an audit row or stage-tag job | no direct writes; `change_quote_request_status` writes the status, audit row, event and (with consent) the stage-tag job in one transaction | none |
| US-008 weekly count | Read counts without a session | `weekly_counts` is security invoker; anon revoked; RLS limits non-staff to zero | none |
| US-016 Pipeline tab | Same as US-007 (drag uses the same RPC) | same | none |
| US-009/010/017 (Should) | Make our runner call GHL twice for one copy | one job per lease, lease id checked on settle | residual only if a single job outlives its 120 s lease (worst case is about 30 s); GHL duplicate search is the backstop |
| US-009 (Should) | Tick the box with a stranger's email so the stranger joins Northside's marketing list | none: nothing verifies the address | accepted by ruling 1B for the test sub-account; OQ-16 before a real client |
| US-009 / US-017 (2A) | Submit a ticked request with a homeowner's phone or email to take over her contact's stage tag, or pre-create her contact with your own phone | tags only, never fields; nothing returned to the submitter | SEC-22 (Minor) |
| US-009 (1B) | Get a GHL job queued for an unticked request | RPCs, insert trigger, column check | update path: SEC-23 (Minor) |
| US-013 (Could) search | Inject PostgREST filter syntax through `q` or the cursor | typed `list_quote_requests` parameters; cursor validated before the call | none |

## Database review (SQL as written at `efcee08`)
### RLS on every table
| Table | `enable` | `force` | Policies | anon | authenticated | service_role | Evidence |
|---|---|---|---|---|---|---|---|
| `staff` | yes | **yes** | select: `is_staff()` | revoked | select | select | 0200:67-76 |
| `quote_requests` | yes | **yes** | select: `is_staff()` and submitted | revoked | select | select, insert, update, delete | 0300:141-155 |
| `quote_photos` | yes | **yes** | select: `is_staff()` and parent submitted | revoked | select | select, insert, update, delete | 0300:170-181 |
| `quote_request_status_changes` | yes | **yes** | select: `is_staff()` | revoked | select | select | 0300:198-210 |
| `ghl_sync_jobs` | yes | **yes** | select: `is_staff()` | revoked | select | select, insert, update, delete (insert guarded by the consent trigger, 0400:56-72) | 0400:75-87 |
| `events` | yes | **yes** | select: `is_staff()` | revoked | select | select, insert, update of `properties` only | 0500:41-56 |
| `rate_limit_hits` | yes | **yes** | restrictive deny-all for anon, authenticated | revoked | revoked | select, insert, delete | 0500:68-78 |
| `spam_refusal_windows` (**new**) | yes (0500:101) | **yes (0500:102)** | restrictive deny-all for anon, authenticated (0500:107-109) | revoked | revoked | select, insert, update, delete | 0500:85-109 |
| `sign_in_attempts` | yes | **yes** | restrictive deny-all for anon, authenticated | revoked | revoked | select, insert, update, delete | 0500:128-136 |
| `sign_in_pauses` (**new**) | yes (0500:154) | **yes (0500:155)** | restrictive deny-all for anon, authenticated (0500:160-162) | revoked | revoked | select, insert, delete (no update: nobody shortens a pause) | 0500:143-162 |
| `storage.objects` (bucket `quote-photos`) | Supabase-managed | Supabase-managed | insert: anon and authenticated through `photo_upload_allowed`; select: staff, only objects recorded in `quote_photos` | insert only | insert, select (staff) | Storage API | 0700:65-81 |

Every grant starts from `revoke all` (which also removes Postgres 17's `MAINTAIN`). No table has a client write policy. Every write is the service role (through security invoker functions or the server) or a `security definer` staff RPC, so there is no child row whose parent is unchecked: the only client-written row is the Storage object, whose parent request is checked in `photo_upload_allowed` (0700:43-49). The two new tables are written only by service-role functions, under per-key advisory locks, and hold only HMAC keys, counts and times. `spam_refusal_windows.event_id` cascades from `events`. The application is single-tenant (one shop), so "tenant" checks reduce to "is a fresh staff session". The service-role grants cover every table the invoker functions write, including `for update` on `spam_refusal_windows` (update granted) and the `properties` update on `events` (column grant plus select). Tests: `rls/spam_refusal_windows.sql:17-18`, `rls/sign_in_pauses.sql:14-15` (enabled and forced), and the catalog-wide `all_tables.sql:20-24, 44-49`.

### Triggers (new in round 3)
| Trigger | Table, timing | Function (security, `search_path`) | What it refuses | Evidence |
|---|---|---|---|---|
| `ghl_sync_jobs_require_consent` | `ghl_sync_jobs`, before insert, per row | `app_private.ghl_sync_jobs_require_consent()` (invoker, `''`; execute revoked from public) | any job whose request has `marketing_consent` false or cannot be seen (fails closed for a role without BYPASSRLS) | 0400:56-72; tests `complete_and_sync.sql:30-31`, `rls/ghl_sync_jobs.sql:28-34` |
| `quote_requests_consent_immutable` | `quote_requests`, before update, per row | `app_private.quote_requests_consent_immutable()` (invoker, `''`; execute revoked from public) | any change to `marketing_consent` or `marketing_consent_at` once the old row is `submitted` | 0300:120-137 |

### Function inventory (who runs as whom)
| Function | Security | Caller check | `search_path` | Executable by | Evidence |
|---|---|---|---|---|---|
| `app_private.is_staff()` | definer (postgres) | is the check | `''` | authenticated, service_role | 0200:29-46 |
| `public.current_staff()` | definer (postgres) | `is_staff()` | `''` | authenticated, service_role | 0200:49-62 |
| `app_private.photo_upload_allowed` | definer (postgres) | is the check | `''` | anon, authenticated, service_role (schema not exposed over REST) | 0700:23-60 |
| `public.save_quote_request_quote` | definer (postgres) | `is_staff()`, version | `''` | authenticated, service_role | 0600:440-497 |
| `public.change_quote_request_status` | definer (postgres) | `is_staff()`, version; stage-tag job only with consent | `''` | authenticated, service_role | 0600:504-571 |
| `public.request_ghl_copy_retry` | definer (postgres) | `is_staff()`; PT409 without consent | `''` | authenticated, service_role | 0600:579-614 |
| `public.take_submission_slot` | invoker | grants only | `''` | service_role | 0600:45-64 |
| `public.start_quote_request` | invoker | grants only | `''` | service_role | 0600:81-167 |
| `public.record_spam_refusal` (**new**) | invoker | grants only; PT422 for a null key or an unknown reason | `''` | service_role | 0600:180-230 |
| `app_private.sign_in_pause_until` (**new**) | invoker | called only by `take_sign_in_attempt` under its locks | `''` | service_role (execute revoked from public) | 0600:243-294 |
| `public.take_sign_in_attempt` (signature now `(email_hash, ip_hash)`) | invoker | grants only; PT422 for a null key; never swallows an error | `''` | service_role | 0600:311-346 |
| `public.mark_sign_in_succeeded` | invoker | grants only | `''` | service_role | 0600:348-361 |
| `public.complete_quote_request` | invoker | grants only; copy job only with consent | `''` | service_role | 0600:370-436 |
| `public.claim_ghl_job` | invoker | grants only | `''` | service_role | 0600:621-647 |
| `public.finish_ghl_job` | invoker | grants only; lease id must match (0600:692-694); `auth`, `config_missing`, `rejected` always fail | `''` | service_role | 0600:663-786 |
| `public.find_ghl_contact_match` (**new**) | invoker, stable | grants only; consented requests only, both sides | `''` | service_role | 0600:796-815 |
| `public.ghl_stage_for_request` (**new**) | invoker, stable | grants only; null for an unticked request | `''` | service_role | 0600:824-842 |
| `public.list_quote_requests` | invoker | RLS | `''` | authenticated, service_role | 0600:853-885 |
| `public.weekly_counts`, `app_private.weekly_counts_at` | invoker | RLS | `''` | authenticated, service_role | 0600:892-928 |
| `app_private.new_reference`, `app_private.set_updated_at` | invoker | n/a | `''` | service_role (`new_reference`, 0600:38); trigger only | 0300:15-35; 0100:21-30 |

The definer functions rely on `postgres` having BYPASSRLS, and the invoker service-role functions rely on `service_role` having it. Supabase documents both, and `all_tables.sql:12-15` asserts both. If either is missing, the affected functions fail closed (error or no rows). The two trigger functions run as whoever writes the row (the service role, or `postgres` inside a definer RPC), and both bypass RLS. pgTAP is installed by no migration; each of the 16 test files installs it inside its own transaction and rolls it back.

## Findings for the architect (status after the round 3 re-review)
Full entries with scenario, exact change, owner and closing evidence are in `.baseleap/reviews/S0.md`.
| ID | Sev | Finding | Status |
|---|---|---|---|
| SEC-1 | Critical | No `force row level security` on any of the 8 tables | **closed** in SQL, now 10 of 10 tables; BYPASSRLS proven live at A2 |
| SEC-2 | Critical | Form-token page could be cached, so a shared nonce merged homeowners' requests | **closed** (contract and database); frontend and QA checks carried forward |
| SEC-3 | Important | Rate limit and sign-in pause were count-then-insert; IPv6 rotated freely | **closed** in SQL; QA parallel probes carried forward |
| SEC-4 | Important | Secrets were not required to fail closed when unset or short | **closed** (contract); code and QA probe carried forward |
| SEC-5 | Important | Database error details (the full failing row) could reach logs and responses | **closed** (contract); backend test carried forward |
| SEC-6 | Important | GHL copy puts unverified, non-consented contacts into an email-marketing tool | **closed in round 3** by ruling 1B (option B): consent column, insert trigger, column check, immutable consent, retry PT409 |
| SEC-7 | Important | GHL job lease could expire mid-batch and `finish_ghl_job` accepted a stale runner | **closed** in SQL (`claim_ghl_job`, lease-checked `finish_ghl_job`) |
| SEC-8, 9, 10, 12, 13, 15 to 20 | Minor | see the review | fixed (SEC-13 URL logging accepted for Gate 2) |
| SEC-11 | Minor | sign-in lockout DoS | **closed in round 3**: ruling 4A adds the per-address limit and accepts the lockout trade-off |
| SEC-14 | Minor | refusal-event growth | **closed in round 3**: `record_spam_refusal()` cap |
| SEC-21 | Minor | counter errors are swallowed without any signal | open, non-blocking (unchanged) |
| SEC-22 | Minor (new, round 3) | the unverified email-or-phone match lets a stranger's request share a real homeowner's GHL contact | open, non-blocking |
| SEC-23 | Minor (new, round 3) | the consent trigger fires on insert only; `service_role` may still repoint a job's `request_id` | open, non-blocking |
| SEC-24 | Minor (new, round 3) | consent covers email offers, but the phone is copied too and nothing stops GHL texting it | open, non-blocking |

## Accepted risks (from SECURITY_MODEL) and this review's view
- **Direct Supabase Auth calls skip the per-email and per-address limits.** Agreed, given passwords of 12+ characters set by Baseleap and sign-up off. Recorded here so nobody calls the limits brute-force protection: they cover our own route only.
- **Lockout trade-off (ruling 4A).** Agreed as Matthew's ruling. From one address an attacker stays under the 20-per-15-minute limit with about 15 failures per 15 minutes, which is enough to keep the owner's email paused almost all the time; a second address doubles that. The recovery is to wait or phone Baseleap, and Baseleap has no way to lift a pause (the server cannot update `sign_in_pauses`; deleting the rows by SQL is the only lever). Worth a runbook line.
- **A tick is the homeowner's word (1B).** Agreed for the test sub-account. SEC-22 and SEC-24 are the two concrete forms this takes; both go to OQ-16 before a real client.
- **A signed-in staff member can change her own password through Supabase Auth directly.** Agreed: it needs her valid session. Note that a session younger than 24 hours needs no reauthentication, so someone who steals a fresh session can change the password and keep access after the session ends, until Baseleap resets it.
- **The spam cap reads low on a flood day.** Agreed (FR-8).
- **Abandoned uploads can fill 1 GB.** Agreed for a distributed attacker now that the limit is atomic and keyed by /64.
- **A leaked request id lets someone add photos for 60 minutes.** Agreed; the submit step re-checks every file.
- **Search text in Vercel's platform request logs (SEC-13).** Agreed for a Could story used by two staff; Matthew may reverse it at Gate 2.
- **Photo EXIF (SEC-16).** Agreed: staff-only, short-lived URLs, and the location is the typed address anyway.
- **Auth recovery and OTP endpoints (SEC-10).** Agreed while no custom SMTP is configured; the runbook rule is devops's.
- **GHL data location unverified (OQ-12).** Agreed for the test sub-account only. It blocks any real client, together with OQ-16.

## Live checks for A2 (read-only, on staging after the migrations run)
| Check | Query or screen | Safe answer |
|---|---|---|
| Owner and server roles bypass RLS (forced RLS leaves the functions working) | `select rolname, rolbypassrls from pg_roles where rolname in ('postgres', 'service_role');` (also `all_tables.sql:12-15`) | both `true`; if not, stop and raise a contract question, never drop `force` |
| Tables are owned by `postgres` | `all_tables.sql:16-18` | passes |
| `is_staff()` can read `auth.sessions` | run `tests/rls/staff.sql` | passes |
| RLS enabled and forced everywhere, including the two new tables | `select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';` | 10 rows, every one `true, true` (`sign_in_pauses` and `spam_refusal_windows` included) |
| anon holds no table privilege | `select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';` | no rows |
| authenticated holds `SELECT` only on the six readable tables | same query with `grantee = 'authenticated'` | `SELECT` only, never on `rate_limit_hits`, `spam_refusal_windows`, `sign_in_attempts` or `sign_in_pauses` |
| `service_role` may update only `events.properties` | `select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'events' and grantee = 'service_role' and privilege_type = 'UPDATE';` | exactly one row: `properties` |
| Nobody can update a pause | `select has_table_privilege('service_role', 'public.sign_in_pauses', 'UPDATE');` | `false` |
| No `public` function executable by anon | `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');` | no rows (a Supabase-owned function here would fail `all_tables.sql`; investigate, don't widen) |
| The new `app_private` functions are not callable by clients | `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authn, has_function_privilege('service_role', p.oid, 'execute') as srv from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname in ('sign_in_pause_until', 'ghl_sync_jobs_require_consent', 'quote_requests_consent_immutable');` | `anon` and `authn` false on all three; `srv` true for `sign_in_pause_until` |
| Both triggers exist and are enabled | `select tgname, tgenabled from pg_trigger where tgname in ('ghl_sync_jobs_require_consent', 'quote_requests_consent_immutable');` | two rows, `tgenabled = 'O'` |
| Service-role functions are invoker | `select proname, prosecdef from pg_proc where proname in ('start_quote_request','take_submission_slot','take_sign_in_attempt','mark_sign_in_succeeded','complete_quote_request','claim_ghl_job','finish_ghl_job','record_spam_refusal','find_ghl_contact_match','ghl_stage_for_request');` | `prosecdef` false on all ten |
| No password function in `public` | `all_tables.sql:75-79` | passes |
| pgTAP absent outside tests | `select extname from pg_extension where extname = 'pgtap';` (outside a test transaction) | no rows |
| Function tests pass under forced RLS, as `service_role` | `npm run db:test` (all 16 files) | every file passes; watch `submission_and_limits.sql` (spam cap, both sign-in limits), `complete_and_sync.sql` (consent trigger, match rule, `rejected`), `status_and_quote.sql` (retry PT409) |
| Bucket private with limits | `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'quote-photos';` | `false`, 5242880, the three image types |
| Sign-up and anonymous sign-ins off | Authentication → Sign In / Providers | both off |
| Password rules (3A) | Authentication → Providers → Email | minimum length 12; "Require reauthentication when changing password" on |
| No mail sender | Authentication → Emails → SMTP settings | default sender (team-only delivery), no custom SMTP |
