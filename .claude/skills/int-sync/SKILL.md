---
name: int-sync
description: Sync jobs and background work for bl-integration — the jobs table worker, cursor-based incremental sync per tenant and provider, field directions and the conflict rule from the integration contract, batches under Vercel's limit, dead letters, reconciliation, and signed scheduled calls that are safe on branches and restores.
---

# Integration · Sync & background jobs

## 1. Tables (the architect's migrations, with RLS)
- `jobs (id, tenant_id, kind, ref, status queued|running|done|failed|dead, attempts, next_run_at, last_error, correlation_id)`
- `integration_events` (see `int-webhooks`)
- `sync_state (tenant_id, provider, resource, cursor, last_success_at, last_error)`
- `provider_health (tenant_id, provider, state closed|open|half_open, consecutive_failures, retry_after)`
No Redis or managed queues: the jobs table and cron (I6, spend gate).

## 2. Directions come from the contract, never from you
Each field's direction (`in`, `out`, `both`, `read-only`) and the conflict rule are in `docs/integration-contract.md`. A field the contract doesn't cover → **CONTRACT QUESTION** to the architect, and build the rest. Record by record, the system of record wins; no silent merges.

## 3. The worker
- One protected route (`/api/jobs/run`) triggered by Vercel Cron or Supabase Cron. It claims due jobs with `update … set status='running' where id in (select … for update skip locked limit N) returning *`, so overlapping runs never double-process.
- Each job is idempotent: safe to run twice.
- Time-box each run under the 300 s function cap (stop claiming at about 240 s) and process in batches.
- Failure → `attempts + 1`, `next_run_at = now() + backoff`. After the max attempts → `dead`, which shows in the Console's failed jobs (I15 alert to DevOps / Maintenance).

## 4. Incremental sync
- Use change feeds where they exist (QuickBooks CDC, a provider's `updated_since` filter, webhooks plus a reconciliation sweep). Avoid full scans; a backfill is a separate, explicitly-run job.
- The cursor advances **only after** a batch commits. On a crash, the batch reruns, which idempotency makes harmless.
- Deletes: handle the provider's soft-delete or tombstone signal. Never infer a delete from a missing row in one page.
- A **reconciliation report** (counts and samples of drift) runs on a schedule and is written to the runbook's health section.

## 5. Scheduled calls are signed
Cron calls carry an HMAC of timestamp + body with a Vault secret, and the receiver rejects mismatches and timestamps older than 5 min. A Supabase branch or restore *with data* copies active cron jobs. Rotating the secret right after making a copy stops the copy from calling production (Supabase's own guidance, notes/supabase-vault-cron.md).

---
Sources (ideas adapted, text ours): be-integrations §4 (Baseleap), alirezarezvani senior-data-engineer (MIT: batch and incremental pipeline patterns), QuickBooks CDC and limits (notes/quickbooks.md), Supabase Cron/Vault (notes/supabase-vault-cron.md).
