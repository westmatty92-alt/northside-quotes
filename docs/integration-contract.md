# Integration Contract: Northside quote requests

**Status:** proposed (locked at Gate 2) · **Build mode:** hybrid (our app is the system of record) · **Implemented by:** bl-integration (`src/lib/server/integrations/ghl/**`, `src/app/api/jobs/ghl-sync/**`) · **Platform docs:** HighLevel API v2, base URL `https://services.leadconnectorhq.com`, read 2026-11-19 (links per section and under Sources)

## Systems and roles
| System | Role | Owner of the setup |
|---|---|---|
| Our app (Next.js on Vercel + Supabase ca-central-1) | System of record for every quote request, photo, price, note, status and pipeline (list and board). Sends a one-way contact copy and stage tags. | dev team |
| GoHighLevel **test sub-account** (never a real client account, AC-009.8) | Email marketing only in v1 (website hosting unused, NG-11). Receives one contact per homeowner tagged `quote-request` plus one stage tag. Never authoritative, never read back, never blocks or loses a request. | CRM Automation (Matthew creates the token) |

## Record ownership
One system of record per record type. The copy never wins a conflict.
| Record | System of record | Copy kept in | Link key |
|---|---|---|---|
| Quote request (fields, photos, price, note, status) | our app | GHL contact holds name, phone, email, address and tags only; photos, price, note, problem text and reference are never sent | `quote_requests.ghl_contact_id` ↔ GHL contact `id` |
| Stage of a request | our app (`quote_requests.status`) | GHL contact tag `quote-new`, `quote-quoted`, `quote-won` or `quote-lost` | same contact id |
| Sync state (copied, waiting, failed) | our app (`ghl_sync_jobs`) | none | `ghl_sync_jobs.request_id` |

## Field mapping
Direction: `in` (platform → our app) · `out` (our app → platform) · `both` (only with a conflict rule below) · `read-only` (we read on demand, never store).
| Record | Our field | Platform field | Direction | Transform / notes |
|---|---|---|---|---|
| Contact | `quote_requests.name` | `name` | out | as typed; sent once, at creation only (FR-15) |
| Contact | `quote_requests.name` (text before the first space) | `firstName` | out | so email merge fields can greet by first name; to confirm whether GHL would derive it from `name` alone |
| Contact | `quote_requests.name` (text after the first space) | `lastName` | out | omitted when the name is one word |
| Contact | `quote_requests.phone` | `phone` | out | E.164: `+1` followed by the 10 stored digits |
| Contact | `quote_requests.email` | `email` | out | as typed (GHL may lower-case it) |
| Contact | `quote_requests.address` | `address1` | out | the whole free-text address; no city, province or postal parsing (NG-8) |
| Contact | constant | `tags` on create | out | `quote-request` plus the stage tag of the request's status at that moment (FR-24, AC-017.3, AC-017.7) |
| Contact | `quote_requests.status` | tags (add) | out | `POST /contacts/{id}/tags` with `quote-request` and `quote-{status}` |
| Contact | `quote_requests.status` | tags (remove) | out | `DELETE /contacts/{id}/tags` with the other three stage tags only; never any other tag (AC-017.8) |
| Contact | `quote_requests.ghl_contact_id` | `id` | in | from the create or duplicate-search response; length-checked; the only value we store from GHL |
| Contact | (none stored) | contact matched by email or phone | read-only | duplicate search before a create; only its `id` is kept |

Never sent: photos (AC-009.6), problem text and reference number (OQ-11, below), price, note, urgency, status history, staff names. After creation the app never changes the contact's name, phone, email or address (AC-009.5, AC-017.14).

## Events and webhooks
**Inbound: None in v1** — GHL never calls our app. There is no `/api/webhooks/*` route, because sync is one-way (NG-6) and nothing is read back from GHL (US-017 out of scope).

Outbound:
| Trigger | Direction | Endpoint / call | Idempotency key | Signature check |
|---|---|---|---|---|
| Request submitted (`complete_quote_request` queues a `contact_copy` job) | out | 1. `GET /contacts/search/duplicate?locationId&email&number` 2. if found: link and add our tags; if not: `POST /contacts` | `ghl_sync_jobs` unique `(request_id)` for `contact_copy`, plus search-before-create (GHL has no Idempotency-Key, see Sources) | n/a |
| Real status change (`change_quote_request_status` queues a `stage_tag` job) | out | `POST /contacts/{id}/tags` (add `quote-request` + new stage tag), then `DELETE /contacts/{id}/tags` (the other three stage tags) | job id; both calls are set operations, safe to repeat; each attempt re-reads the current status | n/a |
| Manual retry (US-014, Could) | out | same as the contact copy | same job row, leased | n/a |

Every request carries `Authorization: Bearer GHL_PRIVATE_INTEGRATION_TOKEN`, `Version: v3` (to confirm, see Open questions), `Accept: application/json`, and a 10-second client timeout.

## Sync jobs
| Job | Schedule | Cursor | Batch size | What it reconciles |
|---|---|---|---|---|
| `ghl-sync` (`GET /api/jobs/ghl-sync`) | first attempt inline with `after()` on submit and on each status change; retries by four daily Vercel Cron entries at 00:00, 06:00, 12:00, 18:00 UTC (±59 min on Hobby); QA triggers it by hand on staging | `ghl_sync_jobs.next_attempt_at` (due jobs, leased 120 s) | 25 per run (`claim_ghl_jobs`) | contact copies and stage tags that are pending or waiting |

Backoff after attempt n = 5 min, 1 h, 3 h, 6 h, 12 h. With cron runs at most about 8 hours apart, no two attempts are more than 20 hours apart (the PRD asks for at least every 24 hours). Attempt 6 is the fifth retry; after it the job is `failed`. Stage-tag jobs wait for the contact copy without counting attempts; if the copy fails, the stage tag fails too.

## Conflicts
No field syncs `both` ways. Our app always wins and GHL is never read back:
- GHL edits to a contact's name, phone, email or address are kept, because the app never writes those fields after creation (AC-017.14).
- Tags the owner adds in GHL are kept; the app adds `quote-request` and one stage tag, and removes only the other three stage tags (AC-017.8). If someone removes a stage tag by hand in GHL, the next status change puts the right one back; there is no reconciliation job.
- **One contact for several requests.** GHL matches contacts by email or phone. A homeowner who sends two requests (AC-001.7) gets two requests in our app but one GHL contact, linked from both. That contact carries the stage tag of whichever of those requests changed status last (last push wins). Flagged under Open questions (OQ-A1-1).
- A contact deleted in GHL is not recreated: a stage-tag push that gets 404 fails with `server_error` and shows "Stage tag failed".

## When the platform is down
| Situation | What users see | What the system does |
|---|---|---|
| GHL times out (over 10 s) or returns 5xx | Homeowner: the normal confirmation (AC-001.9). Staff: "Waiting to retry" or "Stage tag waiting to retry" on SCR-06; every edit still works | Request or status already saved. Job set to `waiting` with the backoff above; event `ghl_*_attempt_failed` with `timeout` or `server_error`; after the 5th retry, `failed` and `ghl_*_gave_up` |
| GHL returns 429 | same as above | `rate_limited`, retried with the same backoff (GHL sends no Retry-After). Our peak is far below 100 calls per 10 s |
| Token missing (`GHL_PRIVATE_INTEGRATION_TOKEN` unset) | Staff: "Copy to GoHighLevel failed" / "Stage tag failed" at once | `config_missing`, job `failed` with no retries (AC-009.3, AC-017.10); token never logged |
| Token revoked or rejected (401, 403) | same as above | `auth`, job `failed` at once; after Matthew replaces the token, US-014 Retry copy (if built) re-runs a copy |
| GHL refuses a create as a duplicate (400, location does not allow duplicates) | "Waiting to retry" | treated as a retryable `server_error`; the next attempt's duplicate search finds and links the existing contact |
| Create timed out but GHL did create the contact | "Waiting to retry", then "Copied" | the next attempt (5 minutes later) finds it by duplicate search and links it: one contact (AC-009.4) |
| Contact deleted in GHL, then the status changes | "Stage tag failed" | 404 on the tag call, `server_error`, job `failed`; never recreated |
| A Vercel Cron run is skipped or late | nothing new | the next run (about 6 hours later) or the next submission or status change picks up due jobs; the longest gap stays under 24 hours unless two runs in a row are skipped |
| Staging preview (Vercel runs no cron there) | same states | inline `after()` attempts run normally; retries run when QA calls `/api/jobs/ghl-sync` with `CRON_SECRET` |

No inbound webhook exists, so "webhook missed" does not apply.

## Credentials and scopes
| System | Auth | Scopes | Stored as |
|---|---|---|---|
| GoHighLevel test sub-account | Private Integration token (sub-account token), `Authorization: Bearer` | `contacts.readonly` (duplicate search), `contacts.write` (create contact, add tags, remove tags). Nothing else: no `locations/tags.write` (missing tags are created by the add-tags call, OQ-15), no custom fields, opportunities, workflows or conversations | env var `GHL_PRIVATE_INTEGRATION_TOKEN` (Vercel, Sensitive, Preview and Production rows, both pointing at the one test sub-account), read only in `src/lib/server/integrations/ghl/client.ts`. Not Supabase Vault: the PRD allows the token in the environment only. Rotate every 90 days (GHL's 7-day overlap) |
| GoHighLevel location | sub-account (location) id, not a secret | n/a | env var `GHL_LOCATION_ID` (Vercel, Config) |
| GoHighLevel base URL | n/a | n/a | env var `GHL_API_BASE_URL`, default `https://services.leadconnectorhq.com`; tests point it at a local stub |

## Setup the platform side must do (handoff to CRM Automation)
- Create a Private Integration in the **test sub-account** with exactly `contacts.readonly` and `contacts.write`; Matthew puts the token into Vercel as `GHL_PRIVATE_INTEGRATION_TOKEN` through the secrets process, and the location id as `GHL_LOCATION_ID`.
- Check the test sub-account's "Allow Duplicate Contact" setting and keep it **off** (GHL then refuses a second contact with the same email or phone, a second guard behind our duplicate search). To confirm with Matthew if the sub-account's current setting differs.
- No tags to create by hand if OQ-15 is confirmed (the add-tags call creates them). If the first live test shows otherwise, create `quote-request`, `quote-new`, `quote-quoted`, `quote-won`, `quote-lost` once.
- No custom fields, workflows, pipelines or opportunities in v1 (NG-6).

## Open questions
- **OQ-11 — Can the reference number and problem text go on the GHL contact without extra GHL setup? Answer: no, so v1 uses option B (contact fields only).** Create Contact has no standard field for either; extra data goes in `customFields`, where each item needs the `id` or `key` of a custom field (https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact). A custom field is created on the location with `POST /locations/{locationId}/customFields`, which needs the extra scope `locations/customFields.write` (https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field). Whether an unknown key is silently dropped or creates a field is not documented: **to confirm**, and it doesn't matter for v1. Option A later costs one handoff item (two custom fields, "Quote reference" and "Problem", created by CRM Automation), one extra mapped field each, and an additive amendment to this file. Sending the problem text also puts more personal detail in GHL (OQ-12), so Matthew should choose it explicitly.
- **OQ-15 — Can the integration add and remove tags on a contact, and is a missing tag created automatically? Answer: yes to both (option A), from the docs; to confirm live on the test sub-account in the first integration step.** Add Tags is `POST /contacts/{contactId}/tags`, scope `contacts.write`, and "A tag that does not exist on the location yet is also created on the location" (https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags). Remove Tags is `DELETE /contacts/{contactId}/tags`, scope `contacts.write`, "Tags the contact does not have are ignored", and removed tags stay on the location (https://marketplace.gohighlevel.com/docs/ghl/contacts/remove-tags). Tags are trimmed and lower-cased, which our names already are. Create Contact also accepts `tags` at creation. Avoid `PUT /contacts/{id}` and Upsert for tags: both overwrite every tag on the contact, which would remove the owner's own tags (https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact, https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact). **Consequence if the live test fails:** if tags must exist first, CRM Automation creates the five tags once (option B, a handoff item, no code change); if the token cannot change tags at all, **US-017 is cut** with the other GHL stories in the PRD's cut order and nothing else changes (option C).
- **OQ-A1-1 (new, for Matthew) — one GHL contact per homeowner, not per request.** Because GHL matches contacts by email or phone and we never change a contact's fields, a homeowner's second request links to the same contact and the stage tag follows the most recent status change among their requests. Recommendation: accept for v1 (GHL's role is email marketing about the person). The alternative, one contact per request, needs "Allow Duplicate Contact" on plus a custom field to find our own contact again: more GHL setup and duplicate people in the marketing list.
- **API version header — to confirm.** The v3 endpoint pages above say `Version: v3`; the Private Integrations page still shows `2021-07-28` in its example, and the versioning page lists both with no retirement date (https://marketplace.gohighlevel.com/docs/Versioning). The client sends `v3` and keeps the version in one constant; the first live call on the test sub-account settles it. Consequence if wrong: every call fails as `server_error` until the constant changes; no data is lost.
- **First and last name split — to confirm** that sending `firstName`/`lastName` alongside `name` is accepted unchanged; if GHL derives them itself, the integration drops the split.
- **Duplicate search right after a create — to confirm** whether a contact created a few seconds earlier is already found by `GET /contacts/search/duplicate` (https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact). The first retry waits 5 minutes and "Allow Duplicate Contact" off is the second guard.

## Sources
- HighLevel Create Contact (Version v3, `contacts.write`, `tags`, `customFields` by id or key, "Idempotency-Key is not supported"), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
- HighLevel Add Tags, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags
- HighLevel Remove Tags, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/remove-tags
- HighLevel Get Duplicate Contact (`contacts.readonly`), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
- HighLevel Upsert Contact and Update Contact (tags overwrite all current tags), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact, https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact
- HighLevel Create Custom Field (`locations/customFields.write`), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field
- HighLevel Private Integrations (Bearer token, scopes chosen at creation and editable, 90-day rotation with 7-day overlap), read 2026-11-19: https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken
- HighLevel Rate limits (100 per 10 s burst, 200,000 per day, 429 without Retry-After), read 2026-11-19: https://marketplace.gohighlevel.com/docs/other/rate-limits
- HighLevel Versioning, read 2026-11-19: https://marketplace.gohighlevel.com/docs/Versioning
