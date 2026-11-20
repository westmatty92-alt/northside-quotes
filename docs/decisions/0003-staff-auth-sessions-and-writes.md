# 0003 — Staff sign-in through our server, 7-day sessions enforced in the database, writes through RPCs

**Status:** proposed
**Date:** 2026-11-19
**Driven by:** FR-9, FR-11, FR-12, FR-20 · US-004, US-006, US-007, US-015, US-016 · locked decisions (two equal staff users, no public sign-up, accounts created by Baseleap, no reset email)
**Implemented in:** `supabase/migrations/20261120000200_staff.sql` · `supabase/migrations/20261120000600_functions.sql` · `docs/openapi.yaml#/paths/~1auth~1sign-in` · `docs/SECURITY_MODEL.md`

## Context
FR-9 asks for email and password sign-in for exactly two accounts, a pause after 5 failed attempts per email in 15 minutes, and sessions of at most 7 days. On Supabase Free, time-boxed sessions are a Pro feature and the Password Verification Attempt hook is a Teams feature, so neither rule can be configured in Supabase Auth at $0. FR-11 and FR-12 also need optimistic concurrency ("changed by someone else"), an audit row for every real status change, and a stage-tag push queued with it, which must happen atomically.

## Decision
1. **Sign-in goes through `POST /api/auth/sign-in`.** The handler first calls `take_sign_in_attempt()` (email stored as an HMAC, kept 24 hours), which under a per-email lock either refuses because the email has 5 failures in the last 15 minutes (429 for 15 minutes from the fifth failure, even with the right password) or records this attempt as a failure up front, so parallel guesses count against each other (S0 SEC-3). Then it calls Supabase Auth with the user's password; only a staff sign-in calls `mark_sign_in_succeeded()`, sets the `@supabase/ssr` cookies, and records `staff_signed_in`. Wrong password and unknown email return the same 401 body.
2. **Staff membership and the 7-day limit are enforced in the database.** `app_private.is_staff()` is true only when `auth.uid()` has a row in `public.staff` **and** the JWT's `session_id` points to an `auth.sessions` row created less than 7 days ago. Every staff RLS policy and RPC uses it, so a stale session reads nothing even if the app forgets to check. API routes map "signed in but `is_staff()` false" to 401 `session_expired`, and the frontend sends the user to SCR-03.
3. **Reads through the API with the user's token; writes only through RPCs.** Route handlers call Supabase with the caller's bearer token (RLS applies). Staff have `select` on their tables and nothing else. Price/note saves, status changes and manual copy retries go through `security definer` functions (`save_quote_request_quote`, `change_quote_request_status`, `request_ghl_copy_retry`) that check `is_staff()`, compare the caller's `version`, and write the row, the audit row, the GHL job and the event in one transaction.
4. The API accepts the Supabase access token as `Authorization: Bearer`, never the cookie, so `/api` has no CSRF surface. Cookies are only read by `src/proxy.ts` to redirect signed-out page visits to SCR-03.

## Alternatives considered
### Sign in from the browser straight to Supabase Auth
- **Pros:** no route; the standard Supabase pattern.
- **Cons:** no per-email lockout on Free; no server-side `staff_signed_in` event.
- **Why not:** FR-9's 5-in-15-minutes rule and the event both need the server.

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
- **Risks:** if a future Supabase release stops giving the `postgres` role read access to `auth.sessions`, `is_staff()` returns false for everyone (fail closed). A2 proves it on staging. RLS is forced on every table (S0 SEC-1), so the `security definer` RPCs rely on `postgres` having `BYPASSRLS`, which Supabase documents and `supabase/tests/rls/all_tables.sql` asserts; without it they fail closed.

## Sources
- Supabase sessions (time-boxed sessions and inactivity timeout "only available on Pro Plans and up"; `session_id` claim maps to `auth.sessions`), read 2026-11-19: https://supabase.com/docs/guides/auth/sessions
- Supabase Auth hooks availability table (Password Verification Attempt: Teams and Enterprise), read 2026-11-19: https://supabase.com/docs/guides/auth/auth-hooks
- Supabase Row Level Security ("On Supabase the owner is `postgres`, which has `bypassrls`"; "a `security definer` function only skips RLS when its owner can"), read 2026-11-19: https://supabase.com/docs/guides/database/postgres/row-level-security
