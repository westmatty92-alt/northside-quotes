# 0002 — Public submission in two calls, photos uploaded straight to private Storage

**Status:** proposed
**Date:** 2026-11-19
**Driven by:** FR-2, FR-3, FR-6, FR-7, FR-8 · US-001, US-002, US-003 · locked spam and photo rules (OQ-1A, OQ-2A)
**Implemented in:** `supabase/migrations/20261120000300_quote_requests.sql` · `supabase/migrations/20261120000600_functions.sql` · `supabase/migrations/20261120000700_storage.sql` · `docs/openapi.yaml#/paths/~1quote-requests` · `#/paths/~1quote-requests~1{request_id}~1submission` · `#/paths/~1storage~1v1~1object~1quote-photos~1{request_id}~1{photo_name}`

## Context
A homeowner sends six fields and up to three photos of up to 5 MB each. Vercel functions refuse request bodies over 4.5 MB, so 15 MB of photos cannot pass through a route handler. FR-3 also says the request and all its photos are stored together or not at all, a double submit makes one request, and the reference number is only issued once everything is stored. The spam checks (honeypot, 3-second minimum, 5 accepted submissions per 10 minutes per network address) must run on the server, and anonymous visitors must not be able to write to tables directly with the public Supabase key.

## Decision
1. **Signed form token.** The Request a quote page is server-rendered with a token `v1.{issued_at}.{nonce}.{hmac}` signed with `APP_SIGNING_SECRET`. It is the named public security scheme `formToken` (header `X-Form-Token`). The server rejects it if the signature is wrong, if it is younger than 3 seconds (the time trap) or older than 24 hours. The nonce is the request's `submission_key`, so a double submit or a retry maps to the same request.
2. **Create (pending).** `POST /api/quote-requests` runs the honeypot, time and rate-limit checks, validates the fields, and inserts a `pending` row with the planned photos (position, type, size). Pending rows are invisible to staff (RLS shows `state = 'submitted'` only) and have no reference number.
3. **Upload.** The browser uploads each photo straight to the private `quote-photos` bucket with the public Supabase key, at `{request_id}/photo-{1..3}`. A `storage.objects` insert policy allows this only into the folder of a pending request created in the last 60 minutes, only for a planned position, and never a fourth object. The bucket itself enforces 5,242,880 bytes and the JPEG/PNG/WebP content types. Nobody but the server can overwrite or delete.
4. **Submit (complete).** `POST /api/quote-requests/{request_id}/submission` (same form token, which must match the request's `submission_key`) lists the folder with the service role, checks the count and each file's first bytes (JPEG, PNG or WebP signature) and size, deletes and refuses any bad file (422, per photo), then calls `complete_quote_request()`. That function, in one transaction, inserts the photo rows, issues the `NQ-` reference, flips the row to `submitted`, queues the GHL contact copy and records `quote_request_submitted`. Only then does the homeowner see SCR-02.
5. Pending rows older than 24 hours and their files are purged by the daily housekeeping job.

## Alternatives considered
### One multipart request with the photos
- **Pros:** one call; simplest client.
- **Cons:** 3 x 5 MB exceeds Vercel's 4.5 MB body limit; FR-6 allows exactly 5 MB per photo.
- **Why not:** it cannot work on Vercel without shrinking photos, which changes FR-6.

### Server-issued signed upload URLs (service role) instead of an anonymous insert policy
- **Pros:** no anonymous storage policy at all.
- **Cons:** the upload rule would live only in application code; the brief requires the database to enforce "own folder, at most 3".
- **Why not:** the policy is a database-level backstop that RLS tests can prove; the route still controls who gets a request id.

### Anonymous insert straight into `quote_requests` under RLS
- **Pros:** no service role in the public path.
- **Cons:** anyone with the public key could skip the honeypot, time trap and rate limit by calling PostgREST directly.
- **Why not:** FR-8 would be unenforceable. Anonymous users get no table privileges at all.

## Consequences
- **Easier:** nothing partial is ever visible; retries after a dropped photo reuse the same pending request (AC-002.6); the reference is never shown for an unsaved request.
- **Harder:** three round trips for a submission with photos; the frontend must upload with a client that sends the public key (not a staff session). The policy also accepts authenticated uploads so a signed-in staff member testing the form is not blocked.
- **Cost:** none. Abandoned pending uploads use Storage until the daily purge (at most 15 MB per pending request, at most 5 pending requests per network address per 10 minutes).
- **Risks:** a request id leaked within its 60-minute window lets a third party add photos to that pending request, up to the planned count, and only of the allowed types. The submit step re-checks every file's bytes. A distributed attacker could fill the 1 GB Free storage with abandoned uploads; the daily purge limits the window (accepted risk, `docs/SECURITY_MODEL.md`).

## Sources
- Vercel request body limit 4.5 MB: https://vercel.com/docs/functions/limitations (dated 2026-08-24)
- Supabase Storage access control ("the only RLS policy required for uploading objects is to grant the INSERT permission"; upsert also needs SELECT and UPDATE), read 2026-11-19: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Free plan max upload 50 MB, 1 GB storage: https://supabase.com/pricing (read 2026-11-19)
