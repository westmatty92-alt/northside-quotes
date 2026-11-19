---
name: ops-observe
description: Observability and incident recovery for bl-devops — the /api/health contract, the read-only production smoke check, a scheduled uptime check that opens a GitHub issue on failure, where logs live (Vercel runtime logs, structured JSON with request ids), Sentry as an opt-in behind a spend gate, and the runbook for incidents and rollbacks. Use when setting up a project, after every release, and when production misbehaves.
---

# DevOps · Observability & Recovery

Know within minutes that production is broken, know where to look, and have a written way back that Matthew can follow at 2 a.m.

## 1. Health

`GET /api/health` (scaffolded by the architect) returns `{ status: "ok", version: <commit sha> }` quickly and without secrets. A database check is added only if it's one cheap query. The smoke check and uptime check both use it; the version proves *which* deployment answered.

## 2. Smoke check (`templates/smoke.mjs` → `scripts/smoke.mjs`)

Run by the release workflow after every production deploy, and by you on staging before handing it to QA:
- `/api/health` → 200, `status: ok`, `version` = the expected commit (retries for up to 2 minutes while the deployment settles);
- every `smokePaths` entry in `infra/environments.json` → 200;
- **read-only** — no sign-ins, writes, test data or third-party calls on production.

## 3. Uptime (`templates/uptime.yml`)

A scheduled GitHub Actions workflow (every 15 minutes; GitHub may delay scheduled runs) runs the smoke check against production. On failure it opens (or comments on) a single `uptime` issue — which notifies Matthew — and closes it when production recovers. Free and good enough for small client stacks; a paid uptime service only via a spend gate.

## 4. Logs and errors

- **Vercel runtime logs** are the default: the backend's structured JSON logs (`request_id`, `route`, `outcome`, `duration_ms`) are searchable there. A user-reported problem with a `request_id` (from a problem+json response) maps straight to its log line.
- **Vercel MCP (read-only use):** list deployments, read build and runtime logs. Its tools that deploy, change projects or buy domains are denied in settings.
- **Sentry is opt-in per project, behind a spend gate** (plan cost and a data-processing agreement for client data). When enabled: `@sentry/nextjs` with PII scrubbing on, release = commit SHA, source maps uploaded in the release workflow (auth token as a production secret), and the Sentry MCP connected read-only for investigating issues.

## 5. Runbook (`docs/runbook.md`, template provided)

You keep it current: how to deploy (the release flow), roll back (`vercel rollback` / `vercel promote`), check health, find logs, rotate each secret, restore the database (Supabase point-in-time recovery — Matthew only), the platform settings that can't be code, and who to contact. Every incident ends with a short entry: what happened, how it was detected, what fixed it, what changes so it doesn't recur.

## 6. Incidents

1. Confirm (health/smoke, logs) and note the start time.
2. If the latest release caused it: **roll back first, investigate second** — prepare the `vercel rollback` for Matthew (or the release workflow has already done it).
3. Find the root cause from logs and the diff; route the fix through the normal flow (ticket → fix → QA → review → Gate 3). No hotfixes straight to `main`.
4. Write the runbook incident entry.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills `observability-designer` (MIT — structured logging, health checks, post-deploy smoke tests, alerting), ccplugins/awesome-claude-code-plugins `monitoring-observability-specialist` (Apache-2.0 — uptime probes, incident runbooks), getsentry/sentry-for-claude (MIT — Sentry setup and MCP; opt-in here), Vercel docs (runtime logs, Vercel MCP).
