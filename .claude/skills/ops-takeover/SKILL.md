---
name: ops-takeover
description: Read-only "how does this project actually ship?" review for bl-devops on an existing project — CI, how and from where deploys happen, environments and setting names per environment, dashboard-only settings, machines and auto-commit jobs, backups and rollback — written as a ship map plus findings, before any DevOps change. Use as the first DevOps step on any project that already exists.
---

# DevOps · Takeover (existing projects)

On a project that already runs, you change nothing until you know how it ships today. You write a **ship map** and findings; fixes are recommendations that go through the project's own approval process.

## 1. What to find (read-only)
- **CI:** workflows per repo (`.github/workflows`, other CI files). None is a finding.
- **Deploys:** for each app, how a change reaches production: Git integration, a CLI from someone's machine, a deploy script, a manual paste (e.g. a CRM page builder). Who can trigger it and from where.
- **Hosts and platforms:** Vercel, Supabase, Cloudflare Pages/Workers, automation hosts (n8n Cloud and similar), anything else that serves traffic or runs jobs.
- **Environments:** which exist (production, preview/staging, local), which branch maps to which, and whether staging shares data with production.
- **Settings:** variable **names** per environment, from code, `.env.example`, config files and deploy scripts. Never open `.env*` other than `.env.example`; never print a value.
- **Dashboard-only settings:** anything configured only in a web console (storage buckets, auth settings, function flags, cron, domains). List them; they're invisible to agents.
- **Machines:** scripts that assume a specific laptop (home-folder paths, local env files, cron on a personal machine), auto-commit or auto-push jobs, and what happens when that machine sleeps.
- **Migrations and rollback:** how schema changes reach production, whether merges apply them, and how a bad release is undone.
- **Monitoring:** health checks, uptime, alerts, error tracking, and who gets told.

## 2. Output
- `docs/ops/ship-map.md` from `templates/ship-map.md`: one row per app (repo · host · how it deploys · from where · who approves · environments · rollback · monitoring), then dashboard-only settings, machines, and setting names per environment.
- **Findings** with severity and fix direction, checked against the standing rules (no dashboard-only objects, one key per project, keys off the host unless needed, no production deploy from a personal machine, CI on every repo, a secret scanner on every auto-commit job).
- **Unknown, needs Matthew:** what the files can't show.

Evidence for every claim (file:line or a command you ran read-only), labelled verified or inferred.
