# 0004 — GHL contact copy and stage tags: job table, inline first try, cron retries that fit Vercel Hobby

**Status:** proposed
**Date:** 2026-11-19 (revised 2026-11-20 for PRD v1.2: rulings 1B and 2A, error class `rejected`)
**Driven by:** FR-14, FR-15, FR-19, FR-24, FR-25 · US-009, US-010, US-014, US-017 · OQ-8A (retry at least every 24 hours, up to 5 retries), OQ-13A (one stage tag, previous removed), OQ-19A (a linked contact's fields are never overwritten) · ledger rulings of 2026-11-20: 1B (GHL only with consent, S0 SEC-6), 2A (one contact per homeowner) · build mode hybrid, app is the system of record
**Implemented in:** `supabase/migrations/20261120000300_quote_requests.sql` (consent, link time, match indexes) · `supabase/migrations/20261120000400_ghl_sync.sql` (consent trigger, `rejected`) · `supabase/migrations/20261120000600_functions.sql` (`find_ghl_contact_match`, `ghl_stage_for_request`, `finish_ghl_job`) · `docs/integration-contract.md` · `docs/openapi.yaml#/paths/~1jobs~1ghl-sync`

## Context
Each stored request must reach the GHL test sub-account as one contact within about 2 minutes, without ever blocking or slowing the homeowner's confirmation, and each real status change must swap the contact's stage tag. Failures are retried at least every 24 hours, up to 5 retries after the first attempt. Vercel Hobby cron jobs run at most once per day each, with up to 59 minutes of jitter, so one daily cron alone can leave a gap of almost 25 hours. GHL does not support an `Idempotency-Key` on contact creation.

## Decision
1. **A job table is the source of truth for sync state.** `ghl_sync_jobs` holds one `contact_copy` job per request (unique) and one active `stage_tag` job per request. A new status change supersedes the active stage-tag job and starts a new one with its own retries. Every attempt re-reads the request's current status, so retries never apply an old stage.
2. **First attempt inline, after the response.** The submission and status-change handlers schedule the request's job with Next.js `after()`, so the attempt runs in the same invocation after the homeowner or staff member already has their answer (FR-14's 3-second rule holds even if GHL takes 30 seconds).
3. **Retries by cron, four times a day.** `vercel.json` (devops) declares four daily cron entries for `GET /api/jobs/ghl-sync` at 00:00, 06:00, 12:00 and 18:00 UTC. Each entry is a once-per-day job, which Hobby allows (100 per project). With jitter the worst gap between runs is about 7 hours 59 minutes.
4. **Backoff after attempt n:** 5 minutes, 1 hour, 3 hours, 6 hours, 12 hours. A job becomes due after its delay and runs at the next cron run (or sooner, when another submission or status change drains due jobs with `after()`). The longest possible gap between two attempts is 12 h + 8 h = 20 hours, inside the 24-hour rule. Attempt 6 is the fifth retry; if it fails the job is `failed` and `ghl_*_gave_up` is recorded. A missing or rejected token (401/403, or no `GHL_PRIVATE_INTEGRATION_TOKEN`) fails at once with no retries (AC-009.3, AC-017.10).
5. **Idempotent contact copy without an idempotency key:** search first (`GET /contacts/search/duplicate` by email and phone), link to a found contact and add our tags; create only when nothing is found; store the contact id on the request. A timed-out create that did succeed is found by the next attempt's search (AC-009.4). Details in `docs/integration-contract.md`.
6. **Jobs are claimed one at a time with a lease** (`claim_ghl_job`, `for update skip locked`, 120-second lease, a new `lease_id` per claim) so cron runs, `after()` drains and the manual retry never run the same job twice at once. `finish_ghl_job` settles a job only with its current `lease_id`, so a runner whose lease expired and was taken over cannot change it (S0 SEC-7). The runner stops claiming when less than 60 seconds of the 300-second function budget is left.
7. Staging previews get no Vercel cron (Vercel runs cron on production only). On staging, the `after()` attempts run as usual and QA triggers retries by calling `/api/jobs/ghl-sync` with `CRON_SECRET`.
8. **Consent gate in the database (ruling 1B).** Jobs are queued only for requests with `marketing_consent` true (`complete_quote_request`, `change_quote_request_status`), and a trigger on `ghl_sync_jobs` refuses any other insert, so no future code path can send an unticked request to GHL by mistake. "Not copied: no offers consent" is derived from the request, not from a job row.
9. **One contact per homeowner, matched in our database first (ruling 2A).** The match rule (same email trimmed and lower-cased, or same 10-digit phone) runs first against our own linked requests (`find_ghl_contact_match`), then GHL's duplicate search, then a create. Linking adds tags only (OQ-19A). The stage tag on a shared contact is computed in one function (`ghl_stage_for_request`, last change wins by `greatest(ghl_linked_at, status_changed_at)`), applied on every link and every stage-tag attempt, so retries in any order converge.
10. **`rejected` fails at once.** GHL 404 and 422 are `rejected` with no retry (the contact is gone, or GHL refused a value; waiting does not help). **400 (architect's call):** on `POST /contacts`, repeat the duplicate search once in the same attempt and link if it now finds the contact (GHL most likely refused a duplicate); otherwise `rejected`. On a tag call, 400 is `rejected`. `finish_ghl_job` enforces "no retry" for `auth`, `config_missing` and `rejected` whatever the runner passes.

## Alternatives considered
### One daily Vercel cron
- **Pros:** simplest.
- **Cons:** jitter of up to 59 minutes makes gaps of up to about 25 hours, breaking "at least every 24 hours".
- **Why not:** fails OQ-8A by a small margin.

### Supabase `pg_cron` + `pg_net` calling the job route every 10 minutes
- **Pros:** free on Supabase, minute precision, works on staging too.
- **Cons:** the cron secret and the Vercel protection-bypass secret would have to live in the database (Vault); a second scheduler to operate.
- **Why not:** four Vercel cron entries meet the rule with less moving machinery. It stays the fallback if Hobby limits change.

### Match contacts through GHL's duplicate search only
- **Pros:** one source of matching (GHL's own); no extra indexes or function on our side.
- **Cons:** an extra GHL call per copy; GHL's search may lag right after a create, so a second request sent minutes after the first could create a duplicate; the behaviour depends on the sub-account's duplicate settings.
- **Why not:** our database already knows which of the homeowner's requests is linked, which makes the second request deterministic and free. GHL's search stays as step 2 for contacts we did not link ourselves (a lost reply).

### Treat 400 like 5xx (retry with backoff)
- **Pros:** a duplicate refused because GHL's search lagged would fix itself on a later attempt.
- **Cons:** a value GHL refuses (our fields are already validated, so this is rare) would be retried five times over about 22 hours before showing "failed".
- **Why not:** the immediate second search covers the duplicate case in the same attempt, and Retry copy (US-014) covers what is left.

### Vercel Pro for per-minute cron
- **Pros:** retries within minutes.
- **Cons:** a recurring cost.
- **Why not:** the PRD only asks for 24 hours, and the $0 limit applies.

## Consequences
- **Easier:** sync state is visible on SCR-06 straight from the job rows; the board and the list never wait on GHL.
- **Harder:** two GHL calls per stage change (add the new tag, then remove the other three stage tags), so for a second or two the contact can carry two stage tags.
- **Cost:** none (Hobby cron, functions within free limits; at most about 8 GHL calls per request against a 200,000-a-day limit).
- **Risks (2A):** a contact deleted by hand in GHL is never recreated; a request linked to it by our database match fails as `rejected` until Baseleap clears the stale `ghl_contact_id` (runbook). Acceptable on the test sub-account.
- **Risks:** GHL's duplicate search may lag just after a create, so a retry right after a timeout could create a second contact. Mitigation: the first retry waits 5 minutes, and the handoff asks CRM Automation to keep "Allow Duplicate Contact" off in the test sub-account so GHL itself refuses a second contact with the same email or phone (to confirm, `docs/integration-contract.md`).

## Sources
- Vercel cron on Hobby (once per day, ±59 min, 100 jobs per project), dated 2026-07-15: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Next.js `after()`: https://nextjs.org/docs/app/api-reference/functions/after (dated 2026-09-16)
- HighLevel Create Contact ("Idempotency-Key is not supported. Retrying a request that timed out can create a duplicate contact."), read 2026-11-19; re-read 2026-11-20 (only 201 documented; 400 "BadRequest" named for uniqueness conflicts, 422 for refused keys): https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
- HighLevel Get Duplicate Contact, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
- HighLevel rate limits (100 per 10 s burst, 200,000 per day, 429 without Retry-After), read 2026-11-19: https://marketplace.gohighlevel.com/docs/other/rate-limits
