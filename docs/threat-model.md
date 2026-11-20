# Threat model: Northside quote requests (2026-11-19, step S0)

**Author:** bl-security · **Reviewed:** the A1 blueprint at `23c6744` (no application code exists yet) · **Verdict and routable directives:** `.baseleap/reviews/S0.md`
**Read in full:** `docs/PRD.md` (requirements, non-goals, open questions), `docs/architecture.md`, `docs/SECURITY_MODEL.md`, `docs/openapi.yaml`, `docs/integration-contract.md`, `docs/decisions/0001` to `0004`, all seven files in `supabase/migrations/`, all twelve files in `supabase/tests/`. **Grepped:** `docs/user-stories.md` (AC-003, AC-004, GHL role), `docs/metrics-spec.md` (event properties), `docs/design-specs.md` (consent), `docs/ops/account-setup.md` (Auth settings, secret rows), `.env.example` (names only).
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
| `APP_SIGNING_SECRET` | forge form tokens (skip the 3-second trap), turn the IP and email HMACs back into addresses | Vercel env (Sensitive) |
| `CRON_SECRET` | trigger the job routes whenever wanted | Vercel env (Sensitive) |
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
| `GET /` (Request a quote page, issues the form token) | anyone | none | none | none | nothing stored; signs a token with `APP_SIGNING_SECRET` | SECURITY_MODEL "The public formToken scheme"; architecture "Public pages" |
| `POST /api/quote-requests` | anyone with a form token | `X-Form-Token` HMAC, 3 s to 24 h | single tenant; anonymous may only create a pending row | zod from `QuoteRequestCreate` (`additionalProperties: false`), honeypot `website`, rate limit 5 per 10 min per address | service role: insert or update one pending `quote_requests` row, insert `rate_limit_hits`, remove that request's uploaded files on a changed replay, insert `spam_submission_blocked` | openapi.yaml:98-181; SECURITY_MODEL:11, 47-52, 72-73 |
| Storage upload `quote-photos/{request_id}/photo-N` | anyone with the publishable key | none (role `anon`) | `nq_quote_photos_insert_own_pending`: pending request, created in the last 60 min, planned position, at most 3 objects | bucket: 5,242,880 bytes, declared type JPEG/PNG/WebP; magic bytes re-checked at submit | insert one object, never overwrite or delete | 20261120000700_storage.sql:12-14, 20-64 |
| `POST /api/quote-requests/{id}/submission` | the holder of the token that created the request | same token, must equal `submission_key` | as above | each object's first bytes and size (service role) | delete bad objects; `complete_quote_request()` (service role only) | openapi.yaml:239-280; 20261120000600_functions.sql:21-83 |
| `POST /api/auth/sign-in` | anyone | email and password through Supabase Auth | staff row required, otherwise signed out and 401 | zod `SignIn`; 5 failures per email HMAC per 15 min | `sign_in_attempts`, `staff_signed_in` event (service role) | SECURITY_MODEL:43; decision 0003 |
| Staff `/api/*` | bearer token holders | `auth.getUser()` then `public.current_staff()` | `app_private.is_staff()`: staff row and JWT `session_id` naming an `auth.sessions` row younger than 7 days | zod per operation; `version` on writes | reads under RLS; writes only through the three staff RPCs | SECURITY_MODEL:13, 44-45, invariants 3-4; 20261120000200_staff.sql:24-57 |
| PostgREST directly (publishable key, or a staff token) | anyone | JWT role | table grants plus RLS; function `execute` grants | SQL types and check constraints | anon: nothing; staff: `select` and the three staff RPCs | revokes and policies in migrations 0200 to 0600; `supabase/tests/rls/*` |
| Supabase Auth API directly | anyone | password, refresh token, recovery or OTP flows | sign-up off, anonymous sign-ins off (account-setup.md:80) | Supabase's own per-IP limits | sessions for existing users only | SECURITY_MODEL:16, 90 |
| `GET /api/jobs/ghl-sync`, `GET /api/jobs/housekeeping` | anyone on the internet | `Authorization: Bearer CRON_SECRET`, constant-time compare | the secret only | none (no input) | claim and settle jobs, GHL calls; purge stale pending rows, their files and counters | openapi.yaml:546-601; SECURITY_MODEL invariant 12 |
| Our server → GHL API | our runner only | Private Integration token | sub-account token, two scopes | n/a | four endpoints only (SECURITY_MODEL invariant 10) | integration-contract.md "Credentials and scopes" |
| GHL responses → our server | GHL (or anything at `GHL_API_BASE_URL`) | TLS to the configured host | n/a | contact id length only (1 to 100 characters) | `quote_requests.ghl_contact_id`, later used in `/contacts/{id}/tags` URLs | 20261120000300_quote_requests.sql:55; SECURITY_MODEL:18 |
| Stored homeowner text → staff screens | staff | n/a | n/a | rendered as React text only (AC-001.5) | staff browser DOM | SECURITY_MODEL invariant 14 |
| Signed photo URLs → staff browser | staff (any holder of the URL for 900 s) | signed URL token | created with the staff member's own token through `nq_quote_photos_select_staff` | n/a | image bytes, served from the Supabase domain with the stored image content type | SECURITY_MODEL invariant 6 |

## Threats per entry point and the control for each
| Entry point | Threat | Control | Holds? |
|---|---|---|---|
| `GET /` | the page is statically rendered or cached, so every visitor gets the same token and nonce | none in the blueprint | **gap, SEC-2 (Critical)** |
| `GET /` | token harvesting: a bot fetches many pages, waits 3 s, posts | the token only proves a page load (SECURITY_MODEL:52); the rate limit is the real throttle | accepted by FR-8 and NG-2; depends on SEC-3 |
| `POST /quote-requests` | spam that skips the checks by writing the table directly | anon has no privileges on any `public` table (0300:89); only the service role writes | holds |
| `POST /quote-requests` | rate limit beaten by parallel requests or IPv6 address rotation | count-then-insert in application code; key = full address | **gap, SEC-3 (Important)** |
| `POST /quote-requests` | a refusal reveals which check failed | honeypot and time trap share one 400 body (openapi.yaml:1288-1301) | holds |
| `POST /quote-requests` | mass assignment of `state`, `reference`, `status`, `price_cents` | `additionalProperties: false` on `QuoteRequestCreate`; the service sets the rest | holds by contract; code not written |
| `POST /quote-requests` | cross-site request from a victim's browser to burn the victim's address quota | the custom `X-Form-Token` header forces a CORS preflight, and no CORS is allowed | holds while no CORS headers are added |
| `POST /quote-requests` | flood of refused submissions writes one `events` row each and grows the 500 MB database | none | Minor, SEC-14 |
| Storage upload | a 4th photo, another name, another request's folder, a submitted or old request | `photo_upload_allowed()` regex, pending, 60 min, planned position, fewer than 3 objects, unique object names (0700:20-57); tested in `tests/rls/storage_objects.sql:44-63` | holds |
| Storage upload | overwrite or delete an uploaded photo (swap the bytes after the server checked them) | no update or delete policy (0700:72-73), so `x-upsert` fails | holds |
| Storage upload | a non-image declared as `image/jpeg` | bucket checks the declared type only; submit checks the first bytes and deletes failures (SECURITY_MODEL invariant 7) | holds by design; code not written |
| Storage upload | a polyglot (valid image header with HTML or script after it) | served from the Supabase domain, not ours, with an `image/*` content type; SVG and HTML types are refused by the bucket | low residual risk |
| Storage upload | a decompression bomb crashes the staff browser; EXIF GPS kept | none | Minor, SEC-16 |
| Storage upload | 1 GB Free storage filled with abandoned uploads | 15 MB per pending request, 5 pending requests per address per 10 min, daily purge | accepted for distributed attacks (SECURITY_MODEL:91); **one host can do it today through SEC-3** |
| `POST /submission` | complete someone else's pending request | the token must equal that request's `submission_key` | holds |
| `POST /submission` | double submit makes two requests or two references | `for update` and replay in `complete_quote_request` (0600:33-42) | holds |
| Reference numbers | guess an `NQ-` reference to read a request | no endpoint accepts a reference from anyone but staff (NG-3); 31^6 (about 8.9 x 10^8) values from `gen_random_bytes` with rejection sampling (0300:12-31) | holds; guessing gains nothing |
| Request ids | guess a pending request id to add photos | uuid v4 (122 random bits), returned only to the token holder; accepted leak case in SECURITY_MODEL:92 | holds |
| `POST /auth/sign-in` | brute force | per-email pause; long generated passwords; direct Auth API calls skip the pause (accepted, SECURITY_MODEL:90) | holds within the accepted risk |
| `POST /auth/sign-in` | lock the owner out by failing 5 times every 15 min with her email | none; FR-9 requires the pause "even with the right password" | Minor, SEC-11 (PM ruling) |
| Supabase Auth directly | password reset or magic link signs someone in although "no reset email" | endpoints exist; no email sender is configured, so mail reaches only the Supabase org's members | Minor, SEC-10 |
| Supabase Auth directly | self sign-up or anonymous sign-in gives an `authenticated` token | both off (account-setup.md:80); without a staff row `is_staff()` is false everywhere | holds (live setting checked by A2) |
| Staff `/api/*` and PostgREST | read with a session older than 7 days or after sign-out | `is_staff()` needs the JWT `session_id` to name a live session younger than 7 days (0200:24-39); signing out deletes the session row | holds; tested in `tests/rls/staff.sql:41-54` |
| Staff RPCs | skip the version check, audit row or stage-tag job by writing tables directly | `authenticated` has `select` only; no write policies; RPCs check `is_staff()` and `version` (0600:100-117, 162-176) | holds |
| Staff RPCs | `security definer` hijack through `search_path` | every definer function sets `search_path = ''` and qualifies every name | holds |
| Staff RPCs | a non-staff or anonymous caller | `revoke ... from public, anon`; `is_staff()` check raises `PT401` | holds; tested |
| All tables | table owner or an owner-owned view or function reads without RLS | RLS enabled, **not forced**, on all 8 tables | **gap, SEC-1 (Critical, house rule)** |
| Storage reads | staff see photos of pending, never-submitted requests | `nq_quote_photos_select_staff` checks the bucket and `is_staff()` only | Minor, SEC-8 |
| `/api/jobs/*` | unset or empty `CRON_SECRET` turns into `Bearer undefined` and opens the route | constant-time compare is required; failing closed when unset is not | **gap, SEC-4 (Important)** |
| GHL runner | two runners do the same job (lease expires mid-batch), so the contact is created twice | 120 s lease for a batch of 25; `finish_ghl_job` does not check who holds the lease | **gap, SEC-7 (Important)** |
| GHL responses | a contact id with `/` or `..` steers later calls to other GHL paths | length check only | Minor, SEC-12 |
| GHL data flow | personal data enrolled in an email-marketing tool without consent, from addresses nobody verified | none; design specs say "for replying only" | **gap, SEC-6 (Important)** |
| Logs | Postgres errors carry "Failing row contains (...)" with the homeowner's details | the log field list excludes personal data, but error objects are not named | **gap, SEC-5 (Important)** |
| Logs | search text (names, phones) in the request URL lands in Vercel's request logs | none | Minor, SEC-13 |
| `events` | personal data in `properties` | the SQL writes ids, enums and counts only (0600:73-76, 132-136, 204-207, 351-384); no database constraint | holds today; Minor, SEC-9 |
| Staff browser | XSS steals the JS-readable session cookie | React text rendering only; `frame-ancestors 'none'`; no `script-src` CSP | Minor, SEC-15 |

## Personal data flows
| Data | Stored | Leaves the app to | Logged? |
|---|---|---|---|
| name, phone, email, address | `quote_requests` (ca-central-1) | GHL test sub-account (hosting location unverified, OQ-12) | must not be; see SEC-5 (DB errors) and SEC-13 (search URLs) |
| problem text, price, note, urgency, reference | `quote_requests` | nowhere (integration-contract.md "Never sent") | must not be |
| photos (with EXIF) | Storage `quote-photos` | nowhere | n/a |
| network address | HMAC only, in `rate_limit_hits`, 24 h | nowhere | our logs: no; Vercel platform request logs keep the client address (outside our control, short retention) |
| staff email | Supabase Auth; HMAC in `sign_in_attempts`, 24 h | nowhere | no |
| staff user id | `events.user_id`, `events.properties.user_id`, audit rows | nowhere | yes (allowed: internal id) |

## Abuse cases (per Must story)
| Story | Attack | Blocked by | Gap |
|---|---|---|---|
| US-001 submit a request | Write `quote_requests` straight through PostgREST with the publishable key, skipping every spam check | anon has no table privileges; RLS test `quote_requests.sql:78-80` | none |
| US-001 | Homeowner B loads a cached page with homeowner A's token; B's create "replays" A's request, overwrites A's pending fields and clears A's photos, or returns A's reference while B's request is never stored | nothing in the blueprint pins per-request rendering | SEC-2 |
| US-001 | Back button after a successful submit re-sends the same token; the second, different request is merged into the first (AC-001.7 allows two requests) | nothing | SEC-2 (variant) |
| US-001 | Script text in name or problem runs in the staff inbox | React text rendering only (AC-001.5, invariant 14) | none (CSP backstop: SEC-15) |
| US-002 attach photos | Upload an executable, HTML or SVG named `photo-1` | bucket type list plus first-bytes check at submit, bad files deleted | none by design; verify in code |
| US-002 | Upload a 4th file, or into another homeowner's folder | storage insert policy and unique object names | none |
| US-002 | Swap a checked photo for another file before `complete_quote_request` runs | no update or delete policy; every planned position is already filled | none |
| US-002 | Fill the 1 GB bucket so real homeowners' uploads fail for up to 24 h | per-address limit and daily purge | SEC-3 makes it a single-host attack |
| US-003 spam protection | 100 parallel creates from one address, each with its own harvested token | rate limit read before any insert commits | SEC-3 |
| US-003 | Rotate through an IPv6 /64 (2^64 addresses) | none | SEC-3 |
| US-003 | Hammer refused submissions to grow `events` | none | SEC-14 |
| US-004 sign in | Guess passwords through our route | per-email pause | none (direct Auth API path accepted) |
| US-004 | Lock the owner out with 5 wrong passwords every 15 minutes | none (FR-9 wording) | SEC-11 |
| US-004 | Keep using a session older than 7 days, or one that was signed out | `is_staff()` session check in every policy and RPC | none |
| US-004 | Get any `authenticated` token (sign-up, anonymous, recovery or OTP) | sign-up and anonymous off; no staff row means nothing is readable; no mail sender | SEC-10 (document the residual) |
| US-005 inbox and detail | Open a pending request by id | RLS `state = 'submitted'`; 404 per contract | none |
| US-005 | Open pending photos by guessing the path | staff-only select policy | SEC-8 (staff can, against invariant 5) |
| US-006 price and note | Overwrite a colleague's save | `version` check in `save_quote_request_quote` (0600:115-117) | none |
| US-006 | Set a price outside 0.01 to 99,999.99 | RPC check plus table check | none |
| US-007 status | Change status without an audit row or stage-tag job | no direct writes; `change_quote_request_status` writes all four in one transaction | none |
| US-008 weekly count | Read counts without a session | `weekly_counts` is security invoker; anon revoked; RLS limits non-staff to zero | none |
| US-016 board | Same as US-007 (drag uses the same RPC) | same | none |
| US-009/010/017 (Should) | Make our runner call GHL twice for one copy | job lease | SEC-7 |
| US-009 (Should) | Type a stranger's email so the stranger joins Northside's marketing list, or tag an existing contact | none | SEC-6 |
| US-013 (Could) search | Inject PostgREST filter syntax through `q` or the cursor | RLS bounds the damage to what staff can already read | SEC-13 |

## Database review (SQL as written)
### RLS on every table
| Table | `enable` | `force` | Policies | anon | authenticated | Evidence |
|---|---|---|---|---|---|---|
| `staff` | yes | **no** | select: `is_staff()` | revoked | select only | 0200:60-67 |
| `quote_requests` | yes | **no** | select: `is_staff()` and submitted | revoked | select only | 0300:88-98 |
| `quote_photos` | yes | **no** | select: `is_staff()` and parent submitted | revoked | select only | 0300:115-125 |
| `quote_request_status_changes` | yes | **no** | select: `is_staff()` | revoked | select only | 0300:141-150 |
| `ghl_sync_jobs` | yes | **no** | select: `is_staff()` | revoked | select only | 0400:47-56 |
| `events` | yes | **no** | select: `is_staff()` | revoked | select only | 0500:30-39 |
| `rate_limit_hits` | yes | **no** | restrictive deny-all for anon, authenticated | revoked | revoked | 0500:50-58 |
| `sign_in_attempts` | yes | **no** | restrictive deny-all for anon, authenticated | revoked | revoked | 0500:70-76 |
| `storage.objects` (bucket `quote-photos`) | Supabase-managed | Supabase-managed | insert: anon and authenticated through `photo_upload_allowed`; select: staff | insert only | insert, select (staff) | 0700:61-70 |

No table has a client write policy. Every write is the service role or a `security definer` function, so there is no child row whose parent is unchecked: the only client-written row is the Storage object, whose parent request is checked in `photo_upload_allowed` (0700:40-46). The application is single-tenant (one shop), so "tenant" checks reduce to "is a fresh staff session".

### `security definer` inventory
| Function | Caller check | `search_path` | Executable by | Evidence |
|---|---|---|---|---|
| `app_private.is_staff()` | is the check | `''` | authenticated, service_role | 0200:24-41 |
| `public.current_staff()` | `is_staff()` | `''` | authenticated, service_role | 0200:44-57 |
| `public.complete_quote_request` | grants only (service role) | `''` | service_role | 0600:21-83 |
| `public.save_quote_request_quote` | `is_staff()`, version | `''` | authenticated, service_role | 0600:87-144 |
| `public.change_quote_request_status` | `is_staff()`, version | `''` | authenticated, service_role | 0600:150-214 |
| `public.request_ghl_copy_retry` | `is_staff()` | `''` | authenticated, service_role | 0600:220-248 |
| `public.claim_ghl_jobs` | grants only | `''` | service_role | 0600:253-277 |
| `public.finish_ghl_job` | grants only (no lease check, SEC-7) | `''` | service_role | 0600:287-399 |
| `app_private.photo_upload_allowed` | is the check | `''` | anon, authenticated, service_role (schema not exposed over REST) | 0700:20-57 |

Security invoker: `public.weekly_counts()`, `app_private.weekly_counts_at()`, `app_private.new_reference()`, `app_private.set_updated_at()`, all with `search_path = ''`.

## Findings for the architect
Full entries with scenario, exact change and owner are in `.baseleap/reviews/S0.md`. SEC-6 is routed to bl-pm first.
| ID | Sev | Finding | Fix direction |
|---|---|---|---|
| SEC-1 | Critical | No `force row level security` on any of the 8 tables | add `alter table ... force row level security` after each `enable` line; assert `relforcerowsecurity` in each RLS test; confirm `postgres` and `service_role` have `rolbypassrls` on staging |
| SEC-2 | Critical | Nothing requires the form-token page to be rendered per request and uncached; a shared nonce merges homeowners' requests | SECURITY_MODEL and architecture: `await connection()` before `issueFormToken()`, `Cache-Control: private, no-store`, a fresh token after each submit; tests for distinct nonces |
| SEC-3 | Important | Rate limit is check-then-insert in app code and keyed on the full address (IPv6 rotates freely) | an atomic `take_submission_slot()` with an advisory lock; key IPv6 by /64; the same pattern for sign-in attempts |
| SEC-4 | Important | Secrets are not required to fail closed when unset or short | SECURITY_MODEL invariant 12 and a new env invariant; env-check for both names |
| SEC-5 | Important | Database error details (the full failing row) can reach logs and responses | name DB and provider error objects in invariant 11; log `code` only; allow-list log fields |
| SEC-6 | Important | GHL copy puts unverified, non-consented contacts into an email-marketing tool | PM decides: copy is for reply tracking only (no campaigns), or add an unticked consent box and copy only when ticked |
| SEC-7 | Important | GHL job lease can expire mid-batch and `finish_ghl_job` accepts a stale runner | claim one job per lease (or size the lease to the batch); add `lease_id` and check it in `finish_ghl_job` |
| SEC-8 to SEC-20 | Minor | storage reads of pending photos, events key allow-list, Auth recovery/OTP residual, sign-in lockout DoS, GHL contact id charset, search text in URLs, refusal-event growth, CSP, image bombs and EXIF, explicit grants, pgTAP in production, HMAC domain separation, GHL base-URL override | see the review |

## Accepted risks (from SECURITY_MODEL) and this review's view
- **Direct Supabase Auth calls skip the per-email pause.** Agreed, given long generated passwords and sign-up off. Recorded here so nobody describes the pause as brute-force protection: it only covers our own route.
- **Abandoned uploads can fill 1 GB.** Agreed for a distributed attacker only after SEC-3 is fixed. Today one host can do it.
- **A leaked request id lets someone add photos for 60 minutes.** Agreed; the submit step re-checks every file.
- **GHL data location unverified (OQ-12).** Agreed for the test sub-account only. It blocks any real client, together with SEC-6.

## Live checks for A2 (read-only, on staging after the migrations run)
| Check | Query or screen | Safe answer |
|---|---|---|
| Owner roles bypass RLS (needed for SEC-1's `force` to leave the RPCs working) | `select rolname, rolbypassrls from pg_roles where rolname in ('postgres', 'service_role');` | both `true` |
| `is_staff()` can read `auth.sessions` | run `tests/rls/staff.sql` | passes |
| RLS enabled and forced everywhere | `select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';` | every row `true, true` |
| anon holds no table privilege | `select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';` | no rows |
| authenticated holds `SELECT` only on the six readable tables | same query with `grantee = 'authenticated'` | `SELECT` only (any `MAINTAIN` row is SEC-17) |
| No `public` function executable by anon | `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');` | no rows |
| Bucket private with limits | `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'quote-photos';` | `false`, 5242880, the three image types |
| Sign-up and anonymous sign-ins off | Authentication → Sign In / Providers | both off |
| No mail sender | Authentication → Emails → SMTP settings | default sender (team-only delivery), no custom SMTP |
