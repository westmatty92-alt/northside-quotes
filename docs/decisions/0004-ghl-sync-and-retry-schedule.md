# 0004 — GHL contact copy and stage tags: job table, inline first try, cron retries that fit Vercel Hobby

**Status:** proposed
**Date:** 2026-11-19
**Driven by:** FR-14, FR-15, FR-19, FR-24 · US-009, US-010, US-014, US-017 · OQ-8A (retry at least every 24 hours, up to 5 retries), OQ-13A (one stage tag, previous removed) · build mode hybrid, app is the system of record
**Implemented in:** `supabase/migrations/20261120000400_ghl_sync.sql` · `supabase/migrations/20261120000600_functions.sql` · `docs/integration-contract.md` · `docs/openapi.yaml#/paths/~1jobs~1ghl-sync`

## Context
Each stored request must reach the GHL test sub-account as one contact within about 2 minutes, without ever blocking or slowing the homeowner's confirmation, and each real status change must swap the contact's stage tag. Failures are retried at least every 24 hours, up to 5 retries after the first attempt. Vercel Hobby cron jobs run at most once per day each, with up to 59 minutes of jitter, so one daily cron alone can leave a gap of almost 25 hours. GHL does not support an `Idempotency-Key` on contact creation.

## Decision
1. **A job table is the source of truth for sync state.** `ghl_sync_jobs` holds one `contact_copy` job per request (unique) and one active `stage_tag` job per request. A new status change supersedes the active stage-tag job and starts a new one with its own retries. Every attempt re-reads the request's current status, so retries never apply an old stage.
2. **First attempt inline, after the response.** The submission and status-change handlers schedule the request's job with Next.js `after()`, so the attempt runs in the same invocation after the homeowner or staff member already has their answer (FR-14's 3-second rule holds even if GHL takes 30 seconds).
3. **Retries by cron, four times a day.** `vercel.json` (devops) declares four daily cron entries for `GET /api/jobs/ghl-sync` at 00:00, 06:00, 12:00 and 18:00 UTC. Each entry is a once-per-day job, which Hobby allows (100 per project). With jitter the worst gap between runs is about 7 hours 59 minutes.
4. **Backoff after attempt n:** 5 minutes, 1 hour, 3 hours, 6 hours, 12 hours. A job becomes due after its delay and runs at the next cron run (or sooner, when another submission or status change drains due jobs with `after()`). The longest possible gap between two attempts is 12 h + 8 h = 20 hours, inside the 24-hour rule. Attempt 6 is the fifth retry; if it fails the job is `failed` and `ghl_*_gave_up` is recorded. A missing or rejected token (401/403, or no `GHL_PRIVATE_INTEGRATION_TOKEN`) fails at once with no retries (AC-009.3, AC-017.10).
5. **Idempotent contact copy without an idempotency key:** search first (`GET /contacts/search/duplicate` by email and phone), link to a found contact and add our tags; create only when nothing is found; store the contact id on the request. A timed-out create that did succeed is found by the next attempt's search (AC-009.4). Details in `docs/integration-contract.md`.
6. **Jobs are claimed with a lease** (`claim_ghl_jobs`, `for update skip locked`, 120-second lease) so cron runs, `after()` drains and the manual retry never run the same job twice at once.
7. Staging previews get no Vercel cron (Vercel runs cron on production only). On staging, the `after()` attempts run as usual and QA triggers retries by calling `/api/jobs/ghl-sync` with `CRON_SECRET`.

## Alternatives considered
### One daily Vercel cron
- **Pros:** simplest.
- **Cons:** jitter of up to 59 minutes makes gaps of up to about 25 hours, breaking "at least every 24 hours".
- **Why not:** fails OQ-8A by a small margin.

### Supabase `pg_cron` + `pg_net` calling the job route every 10 minutes
- **Pros:** free on Supabase, minute precision, works on staging too.
- **Cons:** the cron secret and the Vercel protection-bypass secret would have to live in the database (Vault); a second scheduler to operate.
- **Why not:** four Vercel cron entries meet the rule with less moving machinery. It stays the fallback if Hobby limits change.

### Vercel Pro for per-minute cron
- **Pros:** retries within minutes.
- **Cons:** a recurring cost.
- **Why not:** the PRD only asks for 24 hours, and the $0 limit applies.

## Consequences
- **Easier:** sync state is visible on SCR-06 straight from the job rows; the board and the list never wait on GHL.
- **Harder:** two GHL calls per stage change (add the new tag, then remove the other three stage tags), so for a second or two the contact can carry two stage tags.
- **Cost:** none (Hobby cron, functions within free limits; at most about 8 GHL calls per request against a 200,000-a-day limit).
- **Risks:** GHL's duplicate search may lag just after a create, so a retry right after a timeout could create a second contact. Mitigation: the first retry waits 5 minutes, and the handoff asks CRM Automation to keep "Allow Duplicate Contact" off in the test sub-account so GHL itself refuses a second contact with the same email or phone (to confirm, `docs/integration-contract.md`).

## Sources
- Vercel cron on Hobby (once per day, ±59 min, 100 jobs per project), dated 2026-07-15: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Next.js `after()`: https://nextjs.org/docs/app/api-reference/functions/after (dated 2026-09-16)
- HighLevel Create Contact ("Idempotency-Key is not supported. Retrying a request that timed out can create a duplicate contact."), read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
- HighLevel Get Duplicate Contact, read 2026-11-19: https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
- HighLevel rate limits (100 per 10 s burst, 200,000 per day, 429 without Retry-After), read 2026-11-19: https://marketplace.gohighlevel.com/docs/other/rate-limits
