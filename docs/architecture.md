# Architecture: Northside quote requests

**Status:** proposed (locked at Gate 2) · **Decisions:** `docs/decisions/` (0001 to 0004) · **Security model:** `docs/SECURITY_MODEL.md` · **Contract:** `docs/openapi.yaml` · **Integration contract:** `docs/integration-contract.md`

## Summary
One Next.js (App Router, TypeScript strict) app on Vercel (`yul1`), backed by one Supabase project per environment in ca-central-1 (Postgres with RLS on every table, Auth for the two staff, a private Storage bucket for photos). It is the house stack with no deviations (decision 0001). Homeowners submit through a public page in two calls with photos uploaded straight to Storage (decision 0002); the owner and helper sign in through our server and work the inbox as a list or a four-column board, with every write going through a database function that checks a 7-day staff session and a version number (decision 0003). Each stored request and each status change queues a one-way GoHighLevel sync job that runs right after the response and is retried by four daily Vercel Cron runs, which fits the Hobby plan at $0 (decision 0004). Build mode is hybrid: our app is the system of record and GHL only receives a contact copy and stage tags.

## System diagram
```mermaid
flowchart LR
  home["Homeowner browser (SCR-01, SCR-02)"] -->|"X-Form-Token"| api["Next.js route handlers /api (Vercel yul1)"]
  home -->|"publishable key, RLS insert policy"| storage[("Supabase Storage: quote-photos (private)")]
  staff["Owner / helper browser (SCR-03 to SCR-08)"] -->|"Bearer Supabase token"| api
  staff -->|"sign-out, token refresh"| auth["Supabase Auth"]
  api -->|"user token: reads + staff RPCs"| db[("Supabase Postgres + RLS, ca-central-1")]
  api -->|"service role: submission, jobs, sign-in counter"| db
  api -->|"signed URLs, magic-byte check"| storage
  api -->|"after() and cron: contact copy, stage tags"| ghl["GoHighLevel API v2 (test sub-account)"]
  cron["Vercel Cron x4 daily + housekeeping"] -->|"Bearer CRON_SECRET"| api
```

### Submission sequence (decision 0002)
```mermaid
sequenceDiagram
  participant B as Homeowner browser
  participant A as /api
  participant S as Supabase Storage
  participant D as Postgres
  B->>A: POST /quote-requests (X-Form-Token, fields, photo plan)
  A->>A: token >= 3 s, honeypot empty, rate limit, validate
  A->>D: insert pending request (service role)
  A-->>B: 201 request_id + upload paths
  B->>S: upload photo-1..n (publishable key; RLS: own pending folder, max 3)
  B->>A: POST /quote-requests/{id}/submission (same token)
  A->>S: list + read first bytes, size (service role)
  A->>D: complete_quote_request(): photos, NQ- reference, copy job, event (one transaction)
  A-->>B: 200 reference (SCR-02)
  A->>A: after(): first GHL copy attempt
```

## Modules
| Module | Responsibility | Lives in | Lane |
|---|---|---|---|
| Form token | issue and verify `X-Form-Token` (HMAC, 3 s to 24 h) | `src/lib/server/form-token.ts` | backend |
| Submissions | spam checks, rate limit, pending create/update, photo magic-byte and size check, call `complete_quote_request`, schedule the first GHL attempt | `src/lib/server/services/submissions.ts`, `src/app/api/quote-requests/route.ts` (POST), `src/app/api/quote-requests/[request_id]/submission/route.ts` | backend |
| Inbox reads | list (cursor, status, search), detail (signed photo URLs, GHL state mapping, last updated), photos refresh, weekly count, staff me | `src/lib/server/services/quote-requests.ts`, `src/app/api/quote-requests/route.ts` (GET), `src/app/api/quote-requests/[request_id]/route.ts`, `.../photos/route.ts`, `src/app/api/weekly-counts/current/route.ts`, `src/app/api/staff/me/route.ts` | backend |
| Inbox writes | price and note, status change (RPCs), schedule the stage-tag attempt | `src/lib/server/services/quote-requests.ts`, `.../quote/route.ts`, `.../status-changes/route.ts` | backend |
| Auth | sign-in with per-email pause, route auth helper (`requireStaff`), session refresh and page redirects | `src/lib/server/auth/**`, `src/app/api/auth/sign-in/route.ts`, `src/proxy.ts` | backend |
| HTTP plumbing | problem+json responses, PostgREST error mapping (`PT401` → 401, `PT404` → 404, `PT409` → 409, `PT422` → 422, `23514` → 422), 405 handlers, security headers | `src/lib/server/http.ts`, `next.config.*` headers (A2 scaffolds) | backend |
| Events and logs | write `events` rows (ids only), structured JSON logs | `src/lib/server/events.ts`, `src/lib/server/log.ts` | backend |
| Housekeeping | purge stale pending requests and their files, counters older than 24 h | `src/lib/server/jobs/housekeeping.ts`, `src/app/api/jobs/housekeeping/route.ts` | backend |
| GHL client and runner | GHL HTTP client (token, version, timeout, error classes), contact copy, stage tags, claim/settle jobs, manual retry | `src/lib/server/integrations/ghl/**`, `src/lib/server/jobs/ghl-sync.ts`, `src/app/api/jobs/ghl-sync/route.ts`, `src/app/api/quote-requests/[request_id]/ghl-copy-retries/route.ts` | integration |
| Public pages | SCR-01 form (renders the token from `issueFormToken()`), photo picker and direct upload, SCR-02 (reference kept in `sessionStorage` for reloads in the same tab) | `src/app/(public)/page.tsx`, `src/app/(public)/request-sent/page.tsx`, `src/components/request/**` | frontend |
| Staff pages | SCR-03 sign-in, SCR-04 list, SCR-05 board (drag plus Move to), SCR-06 detail, SCR-07 strip, SCR-08 viewer | `src/app/(public)/sign-in/page.tsx`, `src/app/(staff)/inbox/**`, `src/components/inbox/**` | frontend |
| API client | Orval-generated fetchers, TanStack Query hooks, Zod schemas, MSW mocks; one hand-written fetcher | `src/lib/api/generated/**` (generated), `src/lib/api/fetcher.ts` | architect (generated) / frontend (fetcher) |

**Integration seam.** `src/lib/server/integrations/ghl/index.ts` exports `runGhlJobs(options: { requestId?: string; limit?: number }): Promise<JobRunResult>`. Backend routes call it inside `after()` after a submission completes and after a real status change; the cron route calls it with no `requestId`. A2 scaffolds it as a no-op stub returning zero counts so the backend lane never waits on the integration lane.

**GHL state shown on SCR-06** (backend maps job rows to the contract's `ghl` object):
- `copy`: job `succeeded` → `copied` (at = `last_attempt_at`); `pending` or `waiting` → `waiting` (at = `last_attempt_at`); `failed` → `failed` (at = `last_attempt_at`).
- `stage_tag`: the newest non-superseded `stage_tag` job decides (`succeeded` → `up_to_date`, `pending`/`waiting` → `waiting`, `failed` → `failed`). With no such job, it follows the copy (`copied` → `up_to_date`, `waiting` → `waiting`, `failed` → `failed`), because the contact is created with the current stage tag.

### Routes and screens
| Screen | Route | Operations |
|---|---|---|
| SCR-01 Request a quote | `/` | `createQuoteRequest`, `uploadQuotePhoto` (supabase-js), `submitQuoteRequest` |
| SCR-02 Request sent | `/request-sent` (reads `sessionStorage`; without it, redirects to `/`) | none |
| SCR-03 Staff sign-in | `/sign-in` | `signIn`; sign-out with `supabase.auth.signOut()` |
| SCR-04 Inbox, List | `/inbox` (default view) | `listQuoteRequests` (status, q), `changeQuoteRequestStatus`, `getCurrentWeeklyCount`, `getCurrentStaff` |
| SCR-05 Inbox, Board | `/inbox?view=board` | `listQuoteRequests` once per column (status = new, quoted, won, lost), `changeQuoteRequestStatus`, `getCurrentWeeklyCount` |
| SCR-06 Request detail | `/inbox/[request_id]` ("Back to Inbox" restores view, filter and scroll from client state) | `getQuoteRequest`, `saveQuote`, `changeQuoteRequestStatus`, `retryGhlCopy` (Could) |
| SCR-07 Weekly count | strip on SCR-04 and SCR-05 | `getCurrentWeeklyCount` (refetched after every successful status change) |
| SCR-08 Photo viewer | dialog on SCR-06 | `listQuoteRequestPhotos` when opened and when a URL is near expiry |

## Data model
```mermaid
erDiagram
  AUTH_USERS ||--o| STAFF : "is"
  STAFF ||--o{ QUOTE_REQUESTS : "last updated"
  STAFF ||--o{ QUOTE_REQUEST_STATUS_CHANGES : "made"
  QUOTE_REQUESTS ||--o{ QUOTE_PHOTOS : "has 0-3"
  QUOTE_REQUESTS ||--o{ QUOTE_REQUEST_STATUS_CHANGES : "history"
  QUOTE_REQUESTS ||--o{ GHL_SYNC_JOBS : "sync"
  QUOTE_REQUESTS ||--o{ EVENTS : "about"
  AUTH_USERS ||--o{ EVENTS : "by"
  QUOTE_PHOTOS ||--|| STORAGE_OBJECTS : "file in quote-photos"
  STAFF {
    uuid user_id PK
    text display_name
    timestamptz created_at
  }
  QUOTE_REQUESTS {
    uuid id PK
    uuid submission_key UK
    text state "pending or submitted"
    text reference UK "NQ-XXXXXX"
    text name
    text phone "10 digits"
    text email
    text address
    text problem
    text urgency
    smallint photo_count
    text status "new quoted won lost"
    timestamptz status_changed_at
    bigint price_cents "CAD"
    text note
    timestamptz first_quoted_at
    integer version
    uuid last_staff_update_by FK
    text ghl_contact_id
    timestamptz submitted_at
  }
  QUOTE_PHOTOS {
    uuid id PK
    uuid request_id FK
    smallint position "1-3"
    text storage_path UK
    text content_type
    integer size_bytes
  }
  QUOTE_REQUEST_STATUS_CHANGES {
    uuid id PK
    uuid request_id FK
    text from_status
    text to_status
    uuid changed_by FK
    timestamptz changed_at
  }
  GHL_SYNC_JOBS {
    uuid id PK
    uuid request_id FK
    text kind "contact_copy or stage_tag"
    text target_status
    text state
    smallint attempt_count
    smallint max_attempts
    timestamptz next_attempt_at
    text last_error_class
    timestamptz locked_until
  }
  EVENTS {
    uuid id PK
    text name
    uuid request_id FK
    uuid user_id FK
    jsonb properties
    timestamptz created_at
  }
  RATE_LIMIT_HITS {
    uuid id PK
    text ip_hash "HMAC"
    timestamptz created_at
  }
  SIGN_IN_ATTEMPTS {
    uuid id PK
    text email_hash "HMAC"
    boolean succeeded
    timestamptz created_at
  }
  STORAGE_OBJECTS {
    text bucket_id "quote-photos"
    text name "request_id/photo-N"
  }
```

Migrations: `supabase/migrations/20261120000100_extensions_and_helpers.sql` (pgTAP, pgcrypto, `app_private`), `..0200_staff.sql`, `..0300_quote_requests.sql`, `..0400_ghl_sync.sql`, `..0500_events_and_limits.sql`, `..0600_functions.sql` (RPCs), `..0700_storage.sql` (bucket and `storage.objects` policies). Tests: `supabase/tests/rls/*.sql` (one per table plus storage) and `supabase/tests/functions/*.sql`.

`on delete` choices: photos, history, jobs and events **cascade** from `quote_requests` (a by-hand privacy deletion removes everything about the request); staff references **set null** (history survives a removed account); `staff.user_id` **cascades** from `auth.users`.

Key queries and their indexes:
| Query (screen, story) | Index |
|---|---|
| Inbox list newest first, 50 per page, keyset cursor (SCR-04, US-005) | `quote_requests_inbox_idx (submitted_at desc, id desc) where state = 'submitted'` |
| List filtered by status, and each board column (SCR-04, SCR-05, US-011, US-016) | `quote_requests_status_inbox_idx (status, submitted_at desc, id desc) where state = 'submitted'` |
| Requests this week (SCR-07, US-008) | `quote_requests_inbox_idx` (range on `submitted_at`) |
| Won / Lost this week (SCR-07, US-008) | `quote_requests_status_changed_idx (status, status_changed_at) where state = 'submitted'` |
| Request by id (SCR-06) | primary key |
| Replay of a form token (US-001) | unique `submission_key` |
| Photos of a request in order (SCR-06, SCR-08) | unique `(request_id, position)` |
| Copy job and latest stage-tag job of a request (SCR-06) | `ghl_sync_jobs_request_idx (request_id, kind, created_at desc)` |
| Due sync jobs (runner) | `ghl_sync_jobs_due_idx (next_attempt_at) where state in ('pending','waiting')` |
| Accepted submissions per address, last 10 min (US-003) | `rate_limit_hits_ip_created_idx (ip_hash, created_at desc)` |
| Failed sign-ins per email, last 15 min (US-004) | `sign_in_attempts_email_created_idx (email_hash, created_at desc)` |
| Stale pending purge (housekeeping) | `quote_requests_pending_created_idx (created_at) where state = 'pending'` |
| Metrics by event and window | `events_name_created_idx (name, created_at)` |
| Search by reference, name, phone (US-013, Could) | none on purpose: about 2,400 rows a year, a filtered scan is milliseconds |

## Direct Supabase access (no API route)
| Table | Operations | Why RLS alone is enough |
|---|---|---|
| none (no `public` table) | none | every table read and write goes through `/api` |
| Storage `quote-photos` (anon) | insert into `{request_id}/photo-N` | the insert policy enforces own pending folder, planned position, 60-minute window and at most 3; the server re-checks the bytes before completing |
| Supabase Auth (staff) | sign-out, token refresh | no data; handled by `@supabase/ssr` |

## Stories served without the API
| Story | Why |
|---|---|
| US-004 (part) | Sign-out and access-token refresh use the Supabase Auth client (`supabase.auth.signOut()`, `@supabase/ssr`), and signed-out page visits are redirected to `/sign-in` by `src/proxy.ts`; sign-in itself is `signIn` and the staff check is `getCurrentStaff`. |
| US-002 (part) | The photo bytes go straight to Supabase Storage (`uploadQuotePhoto` documents it, but Supabase implements it), because Vercel functions refuse bodies over 4.5 MB. |
| US-001 (part) | SCR-02 surviving a reload in the same tab is client state (`sessionStorage`), per the designer's ruling; there is no lookup endpoint (NG-3). |
| US-016 (part) | Dragging, the "Saving" state, the revert on failure and the screen-reader message are client-only; the move itself is `changeQuoteRequestStatus`. |

## Lane ownership (copied into build steps)
- **Backend:** `src/proxy.ts`, `src/app/api/**` except `src/app/api/jobs/ghl-sync/**` and `src/app/api/quote-requests/[request_id]/ghl-copy-retries/**`; `src/lib/server/**` except `src/lib/server/integrations/**` and `src/lib/server/jobs/ghl-sync.ts` (services, auth, form token, http, log, env, events, housekeeping; `src/lib/server/admin.ts` is created by A2 and edited only by backend); `supabase/seed.sql`; `tests/api/**`; `tests/helpers/**`
- **Integration:** `src/lib/server/integrations/**` (GHL client, contact copy, stage tags, runner, `index.ts` seam), `src/lib/server/jobs/ghl-sync.ts`, `src/app/api/jobs/ghl-sync/**`, `src/app/api/quote-requests/[request_id]/ghl-copy-retries/**`, `tests/integrations/**`, `tests/mocks/**` (GHL stub server), `docs/integrations/**`
- **Frontend:** `src/app/(public)/**`, `src/app/(staff)/**`, `src/components/**`, `src/hooks/**`, `src/lib/api/fetcher.ts`, `src/lib/supabase/browser.ts` (sessionless client for uploads, session client for auth), `src/lib/utils.ts`, `src/mocks/**`
- **DevOps:** `.github/**`, `vercel.json` (the four `ghl-sync` cron entries at `0 0 * * *`, `0 6 * * *`, `0 12 * * *`, `0 18 * * *` and one `housekeeping` entry at `30 7 * * *`, all UTC; function region `yul1`), `infra/**`, `scripts/install-scanners.sh`, `scripts/env-check.mjs`, `scripts/smoke.mjs`, `.env.example`, `docs/runbook.md`, `docs/deployments/**`
- **Architect (contract; changes through a contract question):** `docs/openapi.yaml`, `docs/integration-contract.md`, `supabase/migrations/**`, `supabase/tests/**`, `orval.config.ts`, `src/lib/shared/**`, generated `src/lib/api/generated/**` and `src/types/database.ts`; scaffold-only files from A2: `src/app/layout.tsx`, `src/app/globals.css`, `next.config.*`, `package.json`
- **Designer (generated):** `src/app/theme.css`
- **QA:** `tests/e2e/**`, `tests/fuzz/**`, `playwright.config.ts`, `docs/test-plan.md`, `docs/qa-reports/**`
- **Security:** `.opengrep/**`, `.gitleaks.toml`, `scripts/security-scan.sh`

Orval note for A2: generate from `docs/openapi.yaml` excluding the `Photo storage` tag (`uploadQuotePhoto` is implemented by Supabase and called through supabase-js).

## Environment variables (names only — values are set by Matthew)
| Name | Used by | Server-only? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server (publishable key; the photo upload and Auth) | no |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/server/admin.ts` only (importers listed in SECURITY_MODEL invariant 2) | **yes** |
| `SITE_URL` | server (absolute URLs) | yes |
| `APP_SIGNING_SECRET` | `src/lib/server/form-token.ts`, the IP and email HMACs (32+ random bytes) — **new, not yet in docs/ops/account-setup.md** | **yes** |
| `CRON_SECRET` | `/api/jobs/*` (Vercel sends it as Bearer on cron calls) — **new** | **yes** |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | `src/lib/server/integrations/ghl/client.ts` only; scopes in `docs/integration-contract.md` | **yes** |
| `GHL_LOCATION_ID` | GHL client (test sub-account id, not secret) — **new** | yes |
| `GHL_API_BASE_URL` | GHL client; optional, defaults to `https://services.leadconnectorhq.com`, tests point it at a stub — **new** | yes |
| `VERCEL_GIT_COMMIT_SHA` | `/api/health` version (Vercel system variable) | yes |
| `SUPABASE_STAGING_DB_URL` | migrations and RLS tests from the orchestrator machine and the GitHub `staging` environment only, never the app | yes |

## Capacity & reliability
| Concern | Expected (from PRD) | Plan |
|---|---|---|
| Volume | up to 200 requests and 600 photos a month (design assumption), 2 users; about 2,400 requests, 7,000 status changes, 25,000 events and 10,000 job rows a year | well inside Supabase Free's 500 MB database; every list is cursor-paginated (50) and index-backed; no unbounded query (the board is four paginated calls) |
| Photo storage | 600 photos a month at 2 to 5 MB | **exceeds Supabase Free's 1 GB in about a month for a real client** (fine for the rehearsal's test data). DECISION line in the A1 report |
| Requests per day | about 7 submissions (3 calls each plus uploads), a few hundred staff reads | no caching, no queue beyond the job table |
| Largest list on a screen | 50 rows (list) or 4 x 50 cards (board) | `limit` max 100 |
| Slow work | GHL calls (up to 30 s when GHL is slow) | never inline in the response: `after()` (same invocation, within the 300 s cap) and cron; 10 s client timeout per GHL call |
| Photo upload | 3 x 5 MB on 4G within 20 s (AC-002.7) | direct to Storage in parallel; nothing passes through Vercel |
| Failure of GoHighLevel | down, slow, 429, token missing or revoked | request and status saved first; job retried with backoff; visible state on SCR-06 (`docs/integration-contract.md`, When the platform is down) |
| Failure of Supabase | database or Storage unreachable | submit: 503, nothing stored, everything kept on screen (AC-001.8); detail: photo URL null → "Photo unavailable" (AC-005.7); weekly count is its own call → "Count unavailable" (AC-008.8) |
| Supabase Free pause | projects pause after 1 week of inactivity | rehearsal staging may pause between runs (resume from the dashboard); a real client needs Pro or regular use. Listed as a risk |
| Rate limits | GHL 100 per 10 s and 200,000 a day per location | at most about 8 GHL calls per request; runner batches of 25 |

**Retry schedule (fits Vercel Hobby at $0).** First attempt inline with `after()`. Then due times after attempt n: 5 min, 1 h, 3 h, 6 h, 12 h. Four Vercel Cron entries run `/api/jobs/ghl-sync` daily at 00:00, 06:00, 12:00 and 18:00 UTC (each entry is once a day, which Hobby allows; ±59 min jitter), so the worst wait after a job is due is about 8 hours and the longest gap between two attempts is 12 h + 8 h = 20 hours, inside "at least every 24 hours". Up to 5 retries after the first attempt, then "failed". New submissions and status changes also drain due jobs with `after()`. No paid plan is needed; Vercel Pro would only make retries faster.

**Failure recovery for each Must flow**
| Flow | Partial failure | Repair |
|---|---|---|
| Submit (US-001, US-002, US-003) | database down at create → 503, nothing stored; an upload fails → that photo shows its error, the same token retries into the same pending request; submit fails → the transaction rolls back, nothing visible; the browser never returns → the pending row and files are purged after 24 h | retry by the homeowner; housekeeping job |
| Sign-in (US-004) | Supabase Auth unreachable → 500, nothing changes | retry |
| Inbox and detail (US-005) | Storage cannot sign a URL → that photo shows "Photo unavailable" | photos refresh call or reload |
| Price and note (US-006) | network drop or 409 → nothing stored (one transaction), typed values kept | retry, or reload on 409 |
| Status from list or board (US-007, US-016) | save fails or 409 → nothing stored, the card returns; GHL down → status saved, stage tag waits | retry; the job retries GHL by itself |
| Weekly count (US-008) | count call fails → "Count unavailable", list unaffected | Try again |
Nothing in these flows can be lost or doubled: every write is one transaction keyed by id, form-token nonce or version.

## Observability
- Health: `GET /api/health` → `{ status: "ok", version }` (no dependency checks; devops and QA rely on it).
- Logs: one JSON line per request from `src/lib/server/log.ts`: `level`, `request_id` (Vercel's `x-vercel-id`), `route`, `method`, `status`, `duration_ms`, `user_id` (staff only), `request` id where relevant, `outcome`, and for GHL `job_id`, `attempt`, `error_class`. Never tokens, secrets, cookies, names, phones, emails, addresses, problem text, notes, prices or network addresses.
- Errors: Vercel function logs (default). No Sentry (it would need a spend gate).
- Analytics events: exactly the metrics-spec events, written server-side to `public.events` in the same ca-central-1 project, ids and enums only; read by staff and Baseleap. No GA4, Meta Pixel or GHL events (NG-11).
- Audit trail: `quote_request_status_changes` (append-only, written only by `change_quote_request_status`) plus `last_staff_update_by/at` on each request (US-015).
- Sync visibility: `ghl_sync_jobs` (state, attempts, last error class, next attempt) is the "needs attention" list; SCR-06 shows it per request.
