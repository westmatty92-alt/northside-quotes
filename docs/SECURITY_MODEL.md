# Security Model: Northside quote requests

**Status:** proposed (locked at Gate 2) · **Reviewed against by:** bl-security (S0 threat model, Phase 4 review) · **Decisions:** 0002, 0003, 0004

## System and scope
Covers the Next.js app on Vercel (pages, `/api/*` route handlers, `src/proxy.ts`), the Supabase project in ca-central-1 (Postgres with RLS, Auth, the private `quote-photos` Storage bucket), the Vercel Cron calls to `/api/jobs/*`, and the outbound calls to the GoHighLevel API for the test sub-account. Out of scope: GoHighLevel's own security and hosting location (OQ-12), Supabase and Vercel platform security, the homeowner's device. There are no embedded screens (NG-11), no payments (NG-5), no email or SMS (NG-1) and no AI features (NG-13).

## Trust boundaries
| Boundary | Untrusted side | Control |
|---|---|---|
| Homeowner browser → `POST /api/quote-requests`, `POST /api/quote-requests/{id}/submission` | every field, the form token, the network address header | `formToken` signature and age check, honeypot, rate limit, zod validation from `docs/openapi.yaml`, then service-role writes in `src/lib/server/services/submissions.ts` only |
| Homeowner browser → Supabase Storage (`uploadQuotePhoto`) | file bytes, declared content type, object name | bucket limits (5,242,880 bytes, JPEG/PNG/WebP) + `nq_quote_photos_insert_own_pending` policy + magic-byte check on submit |
| Staff browser → `/api/*` | bearer token, path ids, bodies | Supabase token verified (`auth.getUser`), `public.current_staff()` must return a row, zod validation; RLS and RPC checks behind it |
| Staff browser → Supabase directly | everything | only Auth (sign-out, token refresh) and nothing else: no table is read or written from the browser |
| Anyone → Supabase PostgREST with the public key | any table, any RPC | anon has no privileges on any `public` table; RPCs revoke `execute` from anon; `app_private` is not exposed |
| Anyone → Supabase Auth API directly | sign-up and password attempts | sign-up disabled in the dashboard (account_setup Part 2); no staff row means `is_staff()` is false; Supabase's per-IP auth limits |
| Vercel Cron → `/api/jobs/*` | the request | `Authorization: Bearer CRON_SECRET`, compared in constant time |
| GoHighLevel responses → our server | status codes, bodies | only the contact id is read and stored (length-checked); bodies are never logged or shown |
| Stored homeowner text → staff screens | name, address, problem (may contain script text) | rendered as React text only; no `dangerouslySetInnerHTML`, no Markdown rendering (AC-001.5) |

## Permission matrix
Anonymous = homeowner or bot (no account). Staff = owner and office helper, identical rights, with a session younger than 7 days. "Non-staff signed in" should never exist (sign-up is off); it is listed so its denial is tested.

| Resource | Anonymous | Non-staff signed in | Staff (owner, helper) | Server (service role, named modules) |
|---|---|---|---|---|
| `quote_requests` | create a pending request only through `POST /api/quote-requests`; no table access | none | read submitted rows; change price, note, status only through RPCs with a version check; never delete | create pending, complete, purge stale pending |
| `quote_photos` | none | none | read | insert through `complete_quote_request` |
| Storage `quote-photos` | insert into its own pending request's folder, planned positions only, at most 3, within 60 minutes; no read | none | read (signed URLs, 900 s) | read for the magic-byte check; delete bad, abandoned or by-hand-deleted files |
| `quote_request_status_changes` | none | none | read; rows written only by `change_quote_request_status` (append-only) | none |
| `ghl_sync_jobs` | none | none | read; re-arm a failed copy through `request_ghl_copy_retry` | claim, settle |
| `events` | none | none | read | insert |
| `staff` | none | none | read | none (Baseleap adds the two rows by SQL, runbook) |
| `rate_limit_hits`, `sign_in_attempts` | none | none | none | insert, read, purge |
| `GET /api/quote-requests`, `GET /api/quote-requests/{id}`, `GET .../photos`, `GET /api/weekly-counts/current`, `GET /api/staff/me` | 401 | 401 `session_expired` | allowed | n/a |
| `PUT .../quote`, `POST .../status-changes`, `POST .../ghl-copy-retries` | 401 | 401 `session_expired` | allowed | n/a |
| `POST /api/quote-requests`, `POST .../submission` | allowed with a valid form token | allowed (no account needed) | allowed | n/a |
| `POST /api/auth/sign-in` | allowed (rate-limited per email) | signed out, 401 | allowed | n/a |
| `GET /api/jobs/*` | 401 | 401 | 401 | Vercel Cron and QA with `CRON_SECRET` |
| `GET /api/health` | allowed | allowed | allowed | allowed |

## Authentication and sessions
- **Staff accounts:** exactly two, created by Baseleap through the Supabase dashboard or admin API, with long generated passwords, plus a row each in `public.staff`. No public sign-up, no reset email, no magic links, no OAuth (NG-4).
- **Sign-in** goes through `POST /api/auth/sign-in` (`src/lib/server/auth/sign-in.ts`), which enforces the per-email pause: if `sign_in_attempts` holds 5 failures for the email's HMAC within 15 minutes, refuse with 429 until 15 minutes after the fifth failure, even with the right password; refused attempts during the pause are not counted. Wrong password and unknown email give the same 401 body. On success the `@supabase/ssr` cookies are set (`Secure`, `SameSite=Lax`; not `httpOnly`, because the browser client reads the access token for the bearer header).
- **API authentication:** the frontend fetcher sends `Authorization: Bearer` with the Supabase access token. Route handlers never authenticate from cookies, so `/api` has no CSRF surface. `src/proxy.ts` reads the cookies only to refresh the session and redirect signed-out page visits to `/sign-in`.
- **7-day sessions:** Supabase Free cannot time-box sessions, so `app_private.is_staff()` requires the JWT's `session_id` to name an `auth.sessions` row created less than 7 days ago. Every staff policy and RPC uses it; the route helper calls `current_staff()` and returns 401 `session_expired` when it is empty, and the frontend signs out and opens SCR-03.

## The public `formToken` scheme
The public operations (`createQuoteRequest`, `submitQuoteRequest`) do not use `security: []`. They declare `formToken`, an `X-Form-Token` header:
- Issued by `src/lib/server/form-token.ts` when the Request a quote page renders on the server: `v1.{issued_at_ms}.{nonce_uuid}.{signature}`, where the signature is base64url HMAC-SHA256 over `form-token|v1|issued_at|nonce` with `APP_SIGNING_SECRET`.
- Verified with a constant-time compare. Valid from 3 seconds (the FR-8 time trap) to 24 hours after issue. Too young gives the generic 400 `submission_refused`; expired gives 400 `form_expired` and the page fetches a fresh token with `router.refresh()` without losing what was typed; a bad signature gives 401 `form_token_invalid`.
- The nonce becomes `quote_requests.submission_key` (unique). Replaying a token returns the same request, so one token can never create more than one request. The submit call must present the token that created the request.
- It proves "this came from a page we rendered at least 3 seconds ago", not who the person is. It is not a secret from the homeowner and carries no personal data.

`uploadQuotePhoto` declares `supabasePublishableKey` (the public `apikey` header). That key grants nothing beyond what RLS allows the anon role, which is the single insert policy on `storage.objects`.

## Security invariants (each must hold; each is checkable)
1. RLS is enabled with at least one policy on every table in `public`, in the migration that creates it, and the anon role has no privileges on any `public` table (`supabase/tests/rls/*.sql`).
2. `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/server/admin.ts`. Only these modules import it: `src/lib/server/services/submissions.ts` (create, photo check, complete), `src/lib/server/auth/sign-in.ts` (`sign_in_attempts`, `staff_signed_in`), `src/lib/server/events.ts` (refusal and photo-failure events), `src/lib/server/integrations/ghl/runner.ts` (claim and settle jobs, read the request's contact fields), `src/lib/server/jobs/housekeeping.ts` (purges). It never appears in client bundles, `NEXT_PUBLIC_*` variables, logs or fixtures.
3. Every route under `src/app/api/` except `/api/health`, `/api/auth/sign-in`, the two `formToken` routes and `/api/jobs/*` rejects a request without a bearer token for which `public.current_staff()` returns a row.
4. Staff never write a table directly: `authenticated` has `select` only, and every staff change goes through a `security definer` RPC that checks `app_private.is_staff()` and the caller's `version`.
5. A request is invisible to staff until it is `submitted`, and a reference number exists only for a submitted request (`quote_requests_submitted_has_reference`, issued only in `complete_quote_request`).
6. Photos are never public: the bucket is private, no policy grants anon or non-staff `select`, there is no update or delete policy, and signed URLs live 900 seconds and are created per staff request with the staff member's own token.
7. A photo is stored only if its first bytes are a JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`) or WebP (`RIFF....WEBP`) signature and it is at most 5,242,880 bytes; anything else is deleted before the request is completed.
8. Spam refusals store nothing in `quote_requests`, issue no reference, and the honeypot and time-trap refusals return byte-identical bodies (FR-8, AC-003.2).
9. `GHL_PRIVATE_INTEGRATION_TOKEN` is read only in `src/lib/server/integrations/ghl/client.ts`. It is never logged, never stored in the database (not in Vault either: the PRD keeps it in the environment only), never sent to the browser, and failure records hold an error class only.
10. The app calls only these GoHighLevel endpoints: `GET /contacts/search/duplicate`, `POST /contacts`, `POST /contacts/{id}/tags`, `DELETE /contacts/{id}/tags`, and removes only the four stage tags it owns (`docs/integration-contract.md`).
11. No personal data in `events.properties`, `ghl_sync_jobs` or logs: ids, enums and counts only. Network addresses and sign-in emails are stored only as HMAC-SHA256 with `APP_SIGNING_SECRET`, and purged after 24 hours.
12. `/api/jobs/*` compares `Authorization: Bearer CRON_SECRET` in constant time and returns 401 otherwise.
13. Every page sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` (no embedding, NG-11), plus `Referrer-Policy: strict-origin-when-cross-origin` and `X-Content-Type-Options: nosniff`.
14. Homeowner text is rendered as text only; nothing renders stored text as HTML.

## Network address for the rate limit
The route takes the client address from `x-forwarded-for`'s first entry as set by Vercel (`request.ip` is not available in route handlers), hashes it with HMAC-SHA256 and `APP_SIGNING_SECRET`, and stores only the hash in `rate_limit_hits` with the time of each accepted submission. Rows are deleted after 24 hours by the housekeeping job. The address is never written to `events` or logs. If the counter cannot be read, the submission is accepted (FR-8, AC-003.5).

## Personal data
| Data | Where | Who can read | Retention | Deletion request |
|---|---|---|---|---|
| Homeowner name, phone, email, address, problem text | `public.quote_requests`, Supabase ca-central-1 | the two staff | 24 months, then Baseleap purges by hand (OQ-10A); rehearsal data is test data | Baseleap deletes the row by SQL (cascades to photos rows, history, jobs and events), removes the `{request_id}/` folder through the Storage API, and deletes the GHL contact by hand in the sub-account (runbook) |
| Photos (may show the inside of a home, may carry EXIF location) | Storage bucket `quote-photos`, ca-central-1 | the two staff, through signed URLs | as above | as above |
| Name, phone, email, address copy | GoHighLevel test sub-account contact | GHL users of that sub-account | GHL's; outside this app | by hand in GHL |
| Staff email | Supabase Auth | Baseleap | while employed | Baseleap removes the auth user (cascades the staff row) |
| HMAC of network address, HMAC of sign-in email | `rate_limit_hits`, `sign_in_attempts` | server only | 24 hours | automatic |

## Finding classes (what counts as a problem here)
- **Critical:** a request, photo or personal field readable without a fresh staff session; any client write that skips the RPCs (audit, version or stage-tag job bypassed); service-role key or GHL token exposed; a way to create requests without the spam checks; a photo reachable by a URL that is not a short-lived signed URL.
- **Important:** a refusal that reveals which spam check failed; personal data in events, job rows or logs; a 7-day-old session still reading data; missing constant-time comparison on the form token or cron secret; a GHL write outside the four allowed endpoints or removal of a tag the app does not own; framing allowed.
- **Minor:** missing non-critical headers; verbose error text that leaks no data.

## Out of scope / accepted risk
- **Direct calls to the Supabase Auth API** skip our per-email pause (the Password Verification hook is a Teams-plan feature). Accepted for $0: passwords are long and generated, Supabase applies its own per-IP auth limits, and sign-up is off.
- **Abandoned uploads.** Someone passing the spam checks can upload up to 15 MB per pending request that is never submitted; at most 5 per address per 10 minutes, purged daily. A distributed attack could still fill the 1 GB Free storage until the next purge. Accepted for the rehearsal; for a real client see the storage DECISION line in the A1 report.
- **A leaked request id** within its 60-minute window lets someone add photos to that pending request, only up to the planned count and only of the allowed types; the submit step re-checks every file.
- **GoHighLevel's data location** is unverified (OQ-12); acceptable only because the sub-account is a test account.

## Known limitations & compensating controls
- The rate limit uses `x-forwarded-for`; behind shared mobile networks several real people may share one address (PRD risk). Every refusal records `spam_submission_blocked` so the threshold can be tuned.
- If a future Supabase release removes the `postgres` role's read access to `auth.sessions`, `is_staff()` returns false for everyone (fails closed); A2's RLS tests on staging prove it works today.
