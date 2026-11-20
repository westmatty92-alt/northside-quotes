# Integration Contract: Northside quote requests

**Status:** proposed (locked at Gate 2), revised for PRD v1.2 (ledger rulings of 2026-11-20: 1B consent, 2A one contact per homeowner) · **Build mode:** hybrid (our app is the system of record) · **Implemented by:** bl-integration (`src/lib/server/integrations/ghl/**`, `src/app/api/jobs/ghl-sync/**`) · **Platform docs:** HighLevel API v2, base URL `https://services.leadconnectorhq.com`, read 2026-11-19 and 2026-11-20 (links per section and under Sources)

**The consent gate (ruling 1B, FR-15, FR-24, FR-25).** Nothing in this file happens for a request whose homeowner did not tick the offers box. Such a request gets no `ghl_sync_jobs` row of either kind (a database trigger refuses one), so the runner never claims anything for it and makes no GHL call: no duplicate search, no create, no tag. It is never linked to a contact (column check) and never counts in "last change wins". Its request detail shows "Not copied: no offers consent" with no Retry and no stage-tag line, and a direct retry call is refused with 409. Consent is stored on the request (`marketing_consent`, `marketing_consent_at`) and never changes after submission (NG-16).

## Systems and roles
| System | Role | Owner of the setup |
|---|---|---|
| Our app (Next.js on Vercel + Supabase ca-central-1) | System of record for every quote request, photo, price, note, status, offers consent and pipeline (Requests and Pipeline tabs). Sends a one-way contact copy and stage tags, for consented requests only. | dev team |
| GoHighLevel **test sub-account** (never a real client account, AC-009.8) | Email marketing only in v1 (website hosting unused, NG-11). Receives one contact per homeowner who ticked the offers box, tagged `quote-request` plus one stage tag. Never authoritative, never read back, never blocks or loses a request. | CRM Automation (Matthew creates the token) |

## Record ownership
One system of record per record type. The copy never wins a conflict.
| Record | System of record | Copy kept in | Link key |
|---|---|---|---|
| Quote request (fields, photos, price, note, status) | our app | for a consented request only: the homeowner's GHL contact holds name, phone, email, address and tags; photos, price, note, problem text and reference are never sent | `quote_requests.ghl_contact_id` ↔ GHL contact `id` (several requests of one homeowner may hold the same id, ruling 2A) |
| Offers consent (yes or no, and its time) | our app (`quote_requests.marketing_consent`, `marketing_consent_at`) | none: the consent itself is never sent; a contact exists in GHL only because consent is yes | the request id |
| Stage of a request | our app (`quote_requests.status`) | GHL contact tag `quote-new`, `quote-quoted`, `quote-won` or `quote-lost`, set by the most recent change among the homeowner's consented requests | same contact id |
| Sync state (copied, waiting, failed, not copied: no consent) | our app (`ghl_sync_jobs`, plus `marketing_consent` for "not copied") | none | `ghl_sync_jobs.request_id` |

## Field mapping
Direction: `in` (platform → our app) · `out` (our app → platform) · `both` (only with a conflict rule below) · `read-only` (we read on demand, never store).
| Record | Our field | Platform field | Direction | Transform / notes |
|---|---|---|---|---|
| Contact | `quote_requests.name` | `name` | out | as typed; sent only when a new contact is created, never when a request is linked to an existing one (FR-15, OQ-19A) |
| Contact | `quote_requests.name` (text before the first space) | `firstName` | out | so email merge fields can greet by first name; to confirm whether GHL would derive it from `name` alone |
| Contact | `quote_requests.name` (text after the first space) | `lastName` | out | omitted when the name is one word |
| Contact | `quote_requests.phone` | `phone` | out | E.164: `+1` followed by the 10 stored digits |
| Contact | `quote_requests.email` | `email` | out | as typed (GHL may lower-case it) |
| Contact | `quote_requests.address` | `address1` | out | the whole free-text address; no city, province or postal parsing (NG-8) |
| Contact | constant | `tags` on create | out | `quote-request` plus the stage tag of the request's status at that moment (FR-24, AC-017.3, AC-017.7) |
| Contact | `public.ghl_stage_for_request(request_id)` | tags (add) | out | `POST /contacts/{id}/tags` with `quote-request` and `quote-{stage}`, where the stage is the status of the most recently changed consented request linked to that contact (last change wins, see Conflicts); used when linking an existing contact and on every stage-tag attempt |
| Contact | `public.ghl_stage_for_request(request_id)` | tags (remove) | out | `DELETE /contacts/{id}/tags` with the other three stage tags only; never any other tag (AC-017.8) |
| Contact | `quote_requests.ghl_contact_id` | `id` | in | from the create or duplicate-search response, or from the match in our own database; used only if it matches `^[A-Za-z0-9_-]{1,100}$` (also a column check), otherwise the attempt fails as `server_error`; always `encodeURIComponent`-ed before it goes into `/contacts/{id}/tags`; the only value we store from GHL. The link time goes in `ghl_linked_at` |
| Contact | (none stored) | contact matched by email or phone | read-only | GHL duplicate search, only when our own database has no match (see Contact match rule); only its `id` is kept |

Never sent: the offers consent itself, photos (AC-009.6), problem text and reference number (OQ-11, below), price, note, urgency, status history, staff names, and anything at all from an unticked request. After creation the app never changes the contact's name, phone, email or address, also not when a later request of the same homeowner is linked to it (AC-009.5, AC-009.10, AC-009.11, AC-017.14, OQ-19A).

## Contact match rule (ruling 2A, FR-15)
**Two requests belong to the same homeowner when they have the same email (compared trimmed and lower-cased) or the same 10-digit phone.** One homeowner has one GHL contact. A contact copy finds that contact in this order and stops at the first hit:
1. **Our database** (`public.find_ghl_contact_match(request_id)`): another consented request matching by the rule that is already linked to a contact; the most recently linked one wins. No GHL call is needed, and it works even when GHL's duplicate search lags right after a create.
2. **GHL duplicate search** (`GET /contacts/search/duplicate?locationId&email&number`): the same rule applied to contacts GHL already holds (for example, one created by an attempt whose reply was lost, AC-009.4).
3. **Create** (`POST /contacts` with the request's fields and tags) only when both found nothing.

When a contact is found in step 1 or 2, the request is **linked**: its `ghl_contact_id` and `ghl_linked_at` are stored, and the runner adds `quote-request` plus the stage tag from `ghl_stage_for_request` and removes the other three stage tags. Nothing else on the contact changes: no name, phone, email or address is sent (OQ-19A). An unticked request is never part of a match, in either direction (AC-009.12, AC-009.13): it is not looked up, not linked, and a later ticked request does not send it.

## Events and webhooks
**Inbound: None in v1** — GHL never calls our app. There is no `/api/webhooks/*` route, because sync is one-way (NG-6) and nothing is read back from GHL (US-017 out of scope).

Outbound:
| Trigger | Direction | Endpoint / call | Idempotency key | Signature check |
|---|---|---|---|---|
| Consented request submitted (`complete_quote_request` queues a `contact_copy` job only when `marketing_consent` is true) | out | the Contact match rule: 1. our database match, 2. `GET /contacts/search/duplicate?locationId&email&number`, 3. `POST /contacts`; when 1 or 2 found a contact: link it, `POST /contacts/{id}/tags`, `DELETE /contacts/{id}/tags` | `ghl_sync_jobs` unique `(request_id)` for `contact_copy`, plus match-before-create (GHL has no Idempotency-Key, see Sources) | n/a |
| Real status change of a consented request (`change_quote_request_status` queues a `stage_tag` job only when `marketing_consent` is true) | out | `POST /contacts/{id}/tags` (add `quote-request` + the stage from `ghl_stage_for_request`), then `DELETE /contacts/{id}/tags` (the other three stage tags) | job id; both calls are set operations, safe to repeat; each attempt re-reads `ghl_stage_for_request`, so a late retry never puts back an older stage | n/a |
| Manual retry (US-014, Could), consented requests only | out | same as the contact copy | same job row, claimed with `claim_ghl_job(p_job_id => …)` and settled with that claim's lease id; an unticked request has no job and `request_ghl_copy_retry` refuses it (409) | n/a |
| Request submitted or status changed **without** consent | none | **no call** | nothing is queued (database trigger) | n/a |

Every request carries `Authorization: Bearer GHL_PRIVATE_INTEGRATION_TOKEN`, `Version: v3` (to confirm, see Open questions), `Accept: application/json`, and a 10-second client timeout.

## Sync jobs
| Job | Schedule | Cursor | Batch size | What it reconciles |
|---|---|---|---|---|
| `ghl-sync` (`GET /api/jobs/ghl-sync`) | first attempt inline with `after()` on submit and on each status change of a consented request; retries by four daily Vercel Cron entries at 00:00, 06:00, 12:00, 18:00 UTC (±59 min on Hobby); QA triggers it by hand on staging | `ghl_sync_jobs.next_attempt_at` (due jobs, contact copies first) | **one job per claim** (`claim_ghl_job`), repeated until no job is due or less than 60 s of the 300 s function budget is left | contact copies and stage tags that are pending or waiting (jobs exist only for consented requests) |

**Leases (S0 SEC-7).** `claim_ghl_job` leases exactly one job for 120 seconds (the worst case of three 10-second GHL calls, with room to spare) and gives it a new `lease_id`. The runner passes that `lease_id` to `finish_ghl_job(p_job_id, p_lease_id, p_outcome, …)`. If the lease expired and another runner (a cron run, an `after()` drain or a manual retry) claimed the job again, the first runner's result is ignored and the job row is returned unchanged; the runner then logs `outcome: lease_lost` and moves on. A status change that supersedes a stage-tag push also drops its lease. One claim never covers a batch, so a slow job can never let a later job's lease run out unseen.

Backoff after attempt n = 5 min, 1 h, 3 h, 6 h, 12 h. With cron runs at most about 8 hours apart, no two attempts are more than 20 hours apart (the PRD asks for at least every 24 hours). Attempt 6 is the fifth retry; after it the job is `failed`. Stage-tag jobs wait for the contact copy without counting attempts; if the copy fails, the stage tag fails too. The error classes `auth`, `config_missing` and `rejected` never retry: `finish_ghl_job` fails the job at once whatever outcome the runner passes.

## Conflicts
No field syncs `both` ways. Our app always wins and GHL is never read back:
- GHL edits to a contact's name, phone, email or address are kept, because the app never writes those fields after creation (AC-017.14).
- Tags the owner adds in GHL are kept; the app adds `quote-request` and one stage tag, and removes only the other three stage tags (AC-017.8). If someone removes a stage tag by hand in GHL, the next status change puts the right one back; there is no reconciliation job.
- **One contact for several requests (decided, ruling 2A).** A homeowner who sends two consented requests (AC-001.7) gets two requests in our app but one GHL contact, linked from both by the Contact match rule. **Last change wins:** the contact carries the stage tag of the request whose most recent change is the latest, where a request's last change is the later of its link time (`ghl_linked_at`, its copy) and its last status change (`status_changed_at`); ties go to the higher request id. `public.ghl_stage_for_request()` computes it in one place, and every stage-tag attempt and every link applies it, so retries in any order end with the right tag (AC-017.15). An unticked request never takes part, even when it changes last (AC-017.17).
- A contact deleted in GHL is not recreated: a tag call that gets 404 is `rejected` and fails at once ("Copy to GoHighLevel failed" when linking, "Stage tag failed" for a push). A request linked by our own database match to a contact that was deleted in GHL fails the same way; Retry copy (US-014) does not recreate it either, because the database match still points at the deleted id. Repair is by hand (Baseleap clears `ghl_contact_id` on the affected requests, runbook), which is acceptable on the test sub-account.

## When the platform is down
| Situation | What users see | What the system does |
|---|---|---|
| GHL times out (over 10 s) or returns 5xx | Homeowner: the normal confirmation (AC-001.9). Staff: "Waiting to retry" or "Stage tag waiting to retry" on SCR-06; every edit still works | Request or status already saved. Job set to `waiting` with the backoff above; event `ghl_*_attempt_failed` with `timeout` or `server_error`; after the 5th retry, `failed` and `ghl_*_gave_up` |
| GHL returns 429 | same as above | `rate_limited`, retried with the same backoff (GHL sends no Retry-After). Our peak is far below 100 calls per 10 s |
| Token missing (`GHL_PRIVATE_INTEGRATION_TOKEN` unset) | Staff: "Copy to GoHighLevel failed" / "Stage tag failed" at once | `config_missing`, job `failed` with no retries (AC-009.3, AC-017.10); token never logged |
| Token revoked or rejected (401, 403) | same as above | `auth`, job `failed` at once; after Matthew replaces the token, US-014 Retry copy (if built) re-runs a copy |
| GHL answers 400 to `POST /contacts` (most likely: it refused a duplicate because "Allow Duplicate Contact" is off; or it refused a value) | "Copied" if the existing contact is found, otherwise "Copy to GoHighLevel failed" at once | **Decision for 400 (architect):** in the same attempt the runner repeats the duplicate search once; if it now finds a contact, it links it and the attempt succeeds (one contact, AC-009.4); if not, the attempt is `rejected` and the job fails at once with no retry. Rationale: our fields are already validated (10-digit phone, email format), so a 400 that is not a duplicate is a payload GHL will refuse every time, and five more tries over 22 hours would only add noise. Retry copy (US-014, Could) is the repair. To confirm live: that a refused duplicate is a 400 and is found by the search |
| GHL answers 400 to a tag call (`POST` or `DELETE /contacts/{id}/tags`) | "Copy to GoHighLevel failed" or "Stage tag failed" at once | `rejected`, fails at once, no retry |
| GHL answers 404 (the contact no longer exists) or 422 (it refused a value) to any call | "Copy to GoHighLevel failed" or "Stage tag failed" at once | `rejected`, fails at once, no retry; a deleted contact is never recreated |
| Create timed out but GHL did create the contact | "Waiting to retry", then "Copied" | the next attempt (5 minutes later) finds it by duplicate search and links it: one contact (AC-009.4) |
| A second consented request of the same homeowner (same email or phone) | "Copied" on both requests | linked to the existing contact by the Contact match rule; tags change, contact fields do not (AC-009.10, AC-009.11) |
| A request whose homeowner did not tick the offers box | "Not copied: no offers consent", no Retry, no stage-tag line | nothing: no job, no call, whatever GHL's state (AC-009.9, AC-010.6, AC-017.16) |
| A Vercel Cron run is skipped or late | nothing new | the next run (about 6 hours later) or the next submission or status change picks up due jobs; the longest gap stays under 24 hours unless two runs in a row are skipped |
| Staging preview (Vercel runs no cron there) | same states | inline `after()` attempts run normally; retries run when QA calls `/api/jobs/ghl-sync` with `CRON_SECRET` |

No inbound webhook exists, so "webhook missed" does not apply.

## Credentials and scopes
| System | Auth | Scopes | Stored as |
|---|---|---|---|
| GoHighLevel test sub-account | Private Integration token (sub-account token), `Authorization: Bearer` | `contacts.readonly` (duplicate search), `contacts.write` (create contact, add tags, remove tags). Nothing else: no `locations/tags.write` (missing tags are created by the add-tags call, OQ-15), no custom fields, opportunities, workflows or conversations | env var `GHL_PRIVATE_INTEGRATION_TOKEN` (Vercel, Sensitive, Preview and Production rows, both pointing at the one test sub-account), read only in `src/lib/server/integrations/ghl/client.ts`. Not Supabase Vault: the PRD allows the token in the environment only. Rotate every 90 days (GHL's 7-day overlap) |
| GoHighLevel location | sub-account (location) id, not a secret | n/a | env var `GHL_LOCATION_ID` (Vercel, Config) |
| GoHighLevel base URL | n/a | n/a | env var `GHL_API_BASE_URL`, default `https://services.leadconnectorhq.com`; tests and previews may point it at a local stub. **When `VERCEL_ENV` is `production` the client ignores it and always uses `https://services.leadconnectorhq.com`**, so a wrong variable can never send the token to another host (S0 SEC-20) |

## Setup the platform side must do (handoff to CRM Automation)
- Create a Private Integration in the **test sub-account** with exactly `contacts.readonly` and `contacts.write`; Matthew puts the token into Vercel as `GHL_PRIVATE_INTEGRATION_TOKEN` through the secrets process, and the location id as `GHL_LOCATION_ID`.
- Check the test sub-account's "Allow Duplicate Contact" setting and keep it **off** (GHL then refuses a second contact with the same email or phone, a second guard behind our duplicate search). To confirm with Matthew if the sub-account's current setting differs.
- No tags to create by hand if OQ-15 is confirmed (the add-tags call creates them). If the first live test shows otherwise, create `quote-request`, `quote-new`, `quote-quoted`, `quote-won`, `quote-lost` once.
- No custom fields, workflows, pipelines or opportunities in v1 (NG-6).
- Every contact this app creates or tags belongs to a homeowner who ticked "Email me offers and news from Northside" (ruling 1B). There is no in-app withdrawal (NG-16): when a person asks to stop, Northside removes the contact (or its `quote-request` tag) by hand in GHL. The app never re-adds a removed contact for an existing request; a new consented request from that person would create or link a contact again, which CRM Automation should know about.

## Open questions
- **S0 SEC-6 — resolved by ruling 1B (2026-11-20), option B.** The form has an unticked, optional offers box; `marketing_consent` and `marketing_consent_at` are stored on `quote_requests` (migration `20261120000300`), `QuoteRequestCreate` carries `marketing_consent` (only JSON `true` is a yes), and the contact copy and every stage tag happen only for ticked requests (see "The consent gate" at the top). Still open for a real client only: OQ-16 (wording check, whether to record the wording version shown, how withdrawal works, CASL and PIPEDA).
- **OQ-A1-1 — resolved by ruling 2A (2026-11-20): one GHL contact per homeowner.** Written above as the Contact match rule and "last change wins" (Conflicts). OQ-19A: linking a later request changes only tags, never the contact's fields.
- **OQ-11 — Can the reference number and problem text go on the GHL contact without extra GHL setup? Answer: no, so v1 uses option B (contact fields only).** Create Contact has no standard field for either; extra data goes in `customFields`, where each item needs the `id` or `key` of a custom field (https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact). A custom field is created on the location with `POST /locations/{locationId}/customFields`, which needs the extra scope `locations/customFields.write` (https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field). Whether an unknown key is silently dropped or creates a field is not documented: **to confirm**, and it doesn't matter for v1. Option A later costs one handoff item (two custom fields, "Quote reference" and "Problem", created by CRM Automation), one extra mapped field each, and an additive amendment to this file. Sending the problem text also puts more personal detail in GHL (OQ-12), so Matthew should choose it explicitly.
- **OQ-15 — Can the integration add and remove tags on a contact, and is a missing tag created automatically? Answer: yes to both (option A), from the docs; to confirm live on the test sub-account in the first integration step.** Add Tags is `POST /contacts/{contactId}/tags`, scope `contacts.write`, and "A tag that does not exist on the location yet is also created on the location" (https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags). Remove Tags is `DELETE /contacts/{contactId}/tags`, scope `contacts.write`, "Tags the contact does not have are ignored", and removed tags stay on the location (https://marketplace.gohighlevel.com/docs/ghl/contacts/remove-tags). Tags are trimmed and lower-cased, which our names already are. Create Contact also accepts `tags` at creation. Avoid `PUT /contacts/{id}` and Upsert for tags: both overwrite every tag on the contact, which would remove the owner's own tags (https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact, https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact). **Consequence if the live test fails:** if tags must exist first, CRM Automation creates the five tags once (option B, a handoff item, no code change); if the token cannot change tags at all, **US-017 is cut** with the other GHL stories in the PRD's cut order and nothing else changes (option C).
- **API version header — to confirm.** The v3 endpoint pages above say `Version: v3`; the Private Integrations page still shows `2021-07-28` in its example, and the versioning page lists both with no retirement date (https://marketplace.gohighlevel.com/docs/Versioning). The client sends `v3` and keeps the version in one constant; the first live call on the test sub-account settles it. Consequence if wrong: every call fails as `server_error` until the constant changes; no data is lost.
- **First and last name split — to confirm** that sending `firstName`/`lastName` alongside `name` is accepted unchanged; if GHL derives them itself, the integration drops the split.
- **Duplicate search right after a create — to confirm** whether a contact created a few seconds earlier is already found by `GET /contacts/search/duplicate` (https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact). For a second request of the same homeowner this no longer matters: step 1 of the match rule finds the contact in our own database. For a lost reply, the first retry waits 5 minutes and "Allow Duplicate Contact" off is the second guard.
- **What GHL answers when it refuses a duplicate — to confirm live.** The Create Contact page documents only the 201 response and mentions a 400 "BadRequest" for uniqueness conflicts on additional emails and phones (read 2026-11-20). The 400 rule above (repeat the duplicate search once, then `rejected`) does not depend on the body, so it holds whatever the exact message is.

## Sources
- HighLevel Create Contact (Version v3, `contacts.write`, `tags`, `customFields` by id or key, "Idempotency-Key is not supported"), read 2026-11-19; re-read 2026-11-20 for error responses (only 201 documented; 400 "BadRequest" named for uniqueness conflicts, 422 for refused DND keys): https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
- HighLevel Add Tags, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags
- HighLevel Remove Tags, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/remove-tags
- HighLevel Get Duplicate Contact (`contacts.readonly`), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
- HighLevel Upsert Contact and Update Contact (tags overwrite all current tags), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact, https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact
- HighLevel Create Custom Field (`locations/customFields.write`), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field
- HighLevel Private Integrations (Bearer token, scopes chosen at creation and editable, 90-day rotation with 7-day overlap), read 2026-11-19: https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken
- HighLevel Rate limits (100 per 10 s burst, 200,000 per day, 429 without Retry-After), read 2026-11-19: https://marketplace.gohighlevel.com/docs/other/rate-limits
- HighLevel Versioning, read 2026-11-19: https://marketplace.gohighlevel.com/docs/Versioning
