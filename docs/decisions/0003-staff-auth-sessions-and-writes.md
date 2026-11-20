# 0003 — Staff sign-in through our server, 7-day sessions enforced in the database, writes through RPCs

**Status:** proposed
**Date:** 2026-11-19 (revised 2026-11-20 for PRD v1.2: rulings 3A and 4A)
**Driven by:** FR-9, FR-11, FR-12, FR-20, FR-26, FR-27 · US-004, US-006, US-007, US-015, US-016 · locked decisions (two equal staff users, no public sign-up, accounts created by Baseleap, no reset email) · ledger rulings of 2026-11-20: 3A (Baseleap sets and resets passwords), 4A (sign-in limits per email and per network address, S0 SEC-11)
**Implemented in:** `supabase/migrations/20261120000200_staff.sql` · `supabase/migrations/20261120000500_events_and_limits.sql` (`sign_in_attempts.ip_hash`, `sign_in_pauses`) · `supabase/migrations/20261120000600_functions.sql` (`take_sign_in_attempt`, `app_private.sign_in_pause_until`) · `docs/openapi.yaml#/paths/~1auth~1sign-in` · `docs/SECURITY_MODEL.md`

## Context
FR-9 asks for email and password sign-in for exactly two accounts, sessions of at most 7 days, and (ruling 4A) two limits: 5 failed attempts for one email within 15 minutes pause that email for 5 minutes; 20 failed attempts from one network address within 15 minutes pause that address for 15 minutes; each count restarts when its pause ends; unknown emails are treated the same; if the counters cannot be read, sign-in is refused. The counters must hold across server instances (Vercel runs many). FR-27 (ruling 3A): Baseleap sets and resets passwords in the Supabase dashboard, and the app has no change or reset path. On Supabase Free, time-boxed sessions are a Pro feature and the Password Verification Attempt hook is a Teams feature, so neither rule can be configured in Supabase Auth at $0. FR-11 and FR-12 also need optimistic concurrency ("changed by someone else"), an audit row for every real status change, and a stage-tag push queued with it, which must happen atomically.

## Decision
1. **Sign-in goes through `POST /api/auth/sign-in`, and both limits are one Postgres call.** The handler first calls `take_sign_in_attempt(email_hash, ip_hash)` (email and address stored as HMACs, kept 24 hours). Under a lock on the email and then on the address, it asks `app_private.sign_in_pause_until()` for each key whether a pause is running; a pause is recorded in `sign_in_pauses` when the newest counted failure completes 5 (email) or 20 (address) failures within 15 minutes, and lasts 5 or 15 minutes from that failure. Only failures at or after the end of a key's latest pause count, which is how "the count restarts when the pause ends" is kept. Paused → 429 `sign_in_paused` with one body for both limits and no `Retry-After` (it would reveal which limit applied). Otherwise the attempt is recorded as a failure up front, so parallel guesses count against each other (S0 SEC-3). Then Supabase Auth is called; only a staff sign-in calls `mark_sign_in_succeeded()`, sets the `@supabase/ssr` cookies, and records `staff_signed_in`. Wrong password and unknown email return the same 401 body. **Any error from the counter call → 503 `sign_in_unavailable`, Supabase Auth is not called** (fail closed, AC-004.13).
2. **Staff membership and the 7-day limit are enforced in the database.** `app_private.is_staff()` is true only when `auth.uid()` has a row in `public.staff` **and** the JWT's `session_id` points to an `auth.sessions` row created less than 7 days ago. Every staff RLS policy and RPC uses it, so a stale session reads nothing even if the app forgets to check. API routes map "signed in but `is_staff()` false" to 401 `session_expired`, and the frontend sends the user to SCR-03.
3. **Reads through the API with the user's token; writes only through RPCs.** Route handlers call Supabase with the caller's bearer token (RLS applies). Staff have `select` on their tables and nothing else. Price/note saves, status changes and manual copy retries go through `security definer` functions (`save_quote_request_quote`, `change_quote_request_status`, `request_ghl_copy_retry`) that check `is_staff()`, compare the caller's `version`, and write the row, the audit row, the GHL job and the event in one transaction.
4. The API accepts the Supabase access token as `Authorization: Bearer`, never the cookie, so `/api` has no CSRF surface. Cookies are only read by `src/proxy.ts` to redirect signed-out page visits to SCR-03 (`/sign-in?next=<tab path>`, allow-listed, FR-26).
5. **No password change or reset path in the app (ruling 3A, FR-27).** Baseleap sets each password (at least 12 characters, different per account) and resets a forgotten one in the Supabase dashboard; the app has no page, link, route or database function for it and sends no email. Devops sets the dashboard's minimum password length to 12 and turns on "Require reauthentication when changing password".

## Alternatives considered
### Sign in from the browser straight to Supabase Auth
- **Pros:** no route; the standard Supabase pattern.
- **Cons:** no per-email lockout on Free; no server-side `staff_signed_in` event.
- **Why not:** FR-9's 5-in-15-minutes rule and the event both need the server.

### Sign-in counters in server memory, or in a key-value store (Redis, Vercel KV, Upstash)
- **Pros:** in-memory is the simplest code; a key-value store has built-in expiry.
- **Cons:** memory is per instance, so Vercel's parallel instances would each allow 5 (and 20) guesses, which breaks the limits; a key-value store is a new service, a new secret and possibly a recurring cost.
- **Why not:** the PRD asks for counters that hold across instances, Postgres already does that with the same atomic lock-count-record pattern as the submission limit, and the volume is tiny.

### Count the per-address limit by a sliding window only, with no pause rows
- **Pros:** one table, no extra writes.
- **Cons:** a sliding window cannot express "the count restarts when the pause ends" (failures from before the pause would still count after it), and a pause computed at read time can be missed when no attempt arrives at the right moment.
- **Why not:** ruling 4A states the restart explicitly; recording the pause end makes it exact and testable.

### Supabase Pro for time-boxed sessions and Teams for the password hook
- **Pros:** the rules live in Supabase Auth itself, including for direct calls to the Auth API.
- **Cons:** $25 a month (Pro) and a Teams plan for the hook.
- **Why not:** the $0 limit. The residual risk (an attacker calling the Supabase Auth API directly, skipping our lockout) is accepted and limited by Supabase's own per-IP auth rate limits and long Baseleap-generated passwords (`docs/SECURITY_MODEL.md`).

### Staff update tables directly under RLS (no RPCs)
- **Pros:** fewer SQL functions.
- **Cons:** a direct PostgREST update could skip the audit row, the version check and the stage-tag job.
- **Why not:** FR-12's audit and FR-24's push must never be skippable.

## Consequences
- **Easier:** RLS tests prove the 7-day rule and the staff-only rule; the audit trail cannot be forged from the client.
- **Harder:** tests must create `auth.sessions` rows; the backend maps Postgres error codes (`PT401`, `PT404`, `PT409`, `PT422`) to problem responses.
- **Cost:** none.
- **Risks (lockout, accepted by ruling 4A):** someone who knows the owner's email can keep her out in 5-minute stretches, and people behind one address with a guesser are paused for 15 minutes; a database outage also stops sign-in (fail closed). Direct calls to the Supabase Auth API skip both limits (accepted, SECURITY_MODEL).
- **Risks:** if a future Supabase release stops giving the `postgres` role read access to `auth.sessions`, `is_staff()` returns false for everyone (fail closed). A2 proves it on staging. RLS is forced on every table (S0 SEC-1), so the `security definer` RPCs rely on `postgres` having `BYPASSRLS`, which Supabase documents and `supabase/tests/rls/all_tables.sql` asserts; without it they fail closed.

## Sources
- Supabase sessions (time-boxed sessions and inactivity timeout "only available on Pro Plans and up"; `session_id` claim maps to `auth.sessions`), read 2026-11-19: https://supabase.com/docs/guides/auth/sessions
- Supabase Auth hooks availability table (Password Verification Attempt: Teams and Enterprise), read 2026-11-19: https://supabase.com/docs/guides/auth/auth-hooks
- Supabase Row Level Security ("On Supabase the owner is `postgres`, which has `bypassrls`"; "a `security definer` function only skips RLS when its owner can"), read 2026-11-19: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase password security (minimum password length and required characters in the Auth settings; "Require reauthentication when changing password", a session counts as recent for 24 hours), read 2026-11-20: https://supabase.com/docs/guides/auth/password-security
