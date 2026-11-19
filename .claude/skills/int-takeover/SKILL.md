---
name: int-takeover
description: Read-only takeover for bl-integration (I17) — before changing anything on a project that already talks to outside systems, find every connection (code, config, env var names, GHL workflows/webhooks, n8n flows, cron jobs), and write the integrations registry and one runbook per provider. Also builds the Baseleap-wide registry. Changes nothing outside docs/integrations/.
---

# Integration · Takeover (read-only)

You can't safely own what you don't know exists. This step **writes only `docs/integrations/**`** and changes no code, config, workflow or data.

## 1. Find every connection
Search, don't guess. Record the evidence (file:line) for each finding.
- **Code:** outbound `fetch`/SDK imports (`stripe`, `@supabase/*`, axios, provider hostnames such as `services.leadconnectorhq.com`, `api.stripe.com`, `quickbooks.api.intuit.com`, `api.loyverse.com`), webhook routes, cron/job code.
- **Config:** `vercel.json` crons, `supabase/config.toml`, scheduled functions, `pg_cron` jobs named in migrations, GitHub Actions schedules.
- **Env var names:** from `.env.example` and code that reads `process.env.*`. **Names only.** `.env.example` is the one exception you may open (it holds names, not values). Never open any other `.env*` file, never print values, and never select token columns (e.g. `ghl_pit_token`).
- **Platform side** (read-only, through the tools the project already has): GHL workflows that call out (webhook actions), inbound webhooks configured in GHL, Stripe webhook endpoints, n8n flows and their triggers. If you can't see a system, list it as **unknown, needs Matthew** rather than skipping it.
- **Data hints:** tables that store external ids (`ghl_contact_id`, `stripe_customer_id`, `qbo_realm_id`) show which way data flows.

## 2. Write the registry (`docs/integrations/README.md`, from `templates/registry.md`)
One row per connection: provider · what flows which way · trigger (webhook / schedule / user action) · auth type and where the credential lives (Vault, env var name, platform setting) · owner · health (last success if visible) · risks (e.g. "full-account token", "no signature check", "no retry").

## 3. One runbook per provider (`docs/integrations/<provider>.md`, from `templates/runbook.md`)
What it does, endpoints and scopes used, webhooks subscribed, schedules, env var names, what users see when it's down, how to reconnect, known issues, and the evidence list.

## 4. Flag, don't fix
Anything unsafe (an unsigned webhook, a token in code or logs, no idempotency on payments, a missing retry) goes in a **Findings** section with a severity and a fix direction, for the orchestrator to plan as a separate step. A takeover never changes behaviour.

## 5. The Baseleap-wide registry
When asked for the whole business, run steps 1–3 per project repo, then merge them into one table grouped by project. The list of projects comes from the brief (the operator keeps it outside the kit; Baseleap's is `build-specs/baseleap-projects.md`). Never assume a project list from memory.

---
Sources: Matthew's instruction (Nov 15: "caught up on the current integrations to take over"), Baseleap secret rules.

## Committing the takeover

Commit with one plain command per call: `git add docs/integrations .baseleap/reports/<STEP>.md`, then `git commit -m "STEP <STEP>: integrations takeover"`. Don't chain with `&&`, `;` or heredocs: pre-approved commands match on the command prefix, so a chained command is refused and the work stays uncommitted.

Check the project against the standing rules in `int-providers` and list every breach under Findings.
