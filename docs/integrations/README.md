# Integration registry

Every connection this app has with a system we do not control. One row per connection. No takeover was run: this is a new build, and the brief states there were no existing integrations (INT1 did not search for others).

| Provider | What flows which way | Trigger | Auth and where the credential lives | Owner | Health | Risks |
|---|---|---|---|---|---|---|
| GoHighLevel (HighLevel API v2), **test sub-account** | **Out only.** For a request whose homeowner ticked the offers box: one contact per homeowner (name, phone, email, address) and tags `quote-request` plus one stage tag (`quote-new`, `quote-quoted`, `quote-won`, `quote-lost`). Nothing is read back (no webhook, no pull). | A job in `ghl_sync_jobs`: first attempt inline with `after()` on submit and on a real status change; retries by Vercel Cron (four entries a day, INT2/DevOps) and by the backoff 5 min, 1 h, 3 h, 6 h, 12 h | Private Integration token (`contacts.readonly`, `contacts.write`), env var `GHL_PRIVATE_INTEGRATION_TOKEN`, read only in `client.ts`; location id in `GHL_LOCATION_ID`. Not Vault (the PRD keeps it in the environment) | integration lane (code), CRM Automation (platform setup), Matthew (token) | **never run live.** Offline simulator only. Failed or waiting jobs: `ghl_sync_jobs` | No Idempotency-Key at GHL (match-before-create instead). The token can read and write every contact in its sub-account (two scopes, but no per-contact limit). No signed inbound traffic exists. Retries run at most about 8 hours apart on Hobby cron. 14 live behaviours unverified, see `ghl.md` |

Runbook, profile, simulator and the unverified-live list: [`ghl.md`](ghl.md).

## Standing-rule check (int-providers)
1. Nothing is created in a dashboard by this code. The one dashboard action is the GHL Private Integration, which only CRM Automation can create (handoff in `ghl.md`). Cron entries live in `vercel.json` (DevOps), not in a dashboard.
2. One key per project per provider: the one test-sub-account token, Preview and Production rows both pointing at it for the rehearsal. A real client gets its own.
3. The service-role key is imported by exactly one integration file, `runner.ts`, on the SECURITY_MODEL allow-list; `node scripts/check-code-guards.mjs service-role` passes.
4. No inbound webhook in v1, so no endpoint to sign and no inbox table.
5. No n8n, Zapier or Make.
