# Runbook: <project>

Owner: bl-devops (kept current every release) · Actions marked **Matthew** need his access.

## At a glance

| | |
|---|---|
| Production | <URL> · Vercel project `<name>` · Supabase `<project ref>` (<region>) |
| Staging | <branch URL> · Supabase staging branch `<ref>` |
| Health | `GET /api/health` → `{ status: "ok", version: <sha> }` |
| Logs | Vercel → project → Logs (filter by `request_id`) |
| Uptime | GitHub Actions `uptime` workflow → issue labelled `uptime` |
| Release log | `docs/deployments/release-log.md` |

## Deploy (normal release)

1. Gate 3 approved in the ledger → DevOps opens PR `staging → main` → checks pass → merge.
2. **Matthew:** approve the `release` run in GitHub (production environment).
3. Workflow: migrations → prebuilt deploy → smoke → auto-rollback on failure. Result in the run summary and the release log.

## Roll back

- **App (Matthew):** `vercel rollback` (previous production deployment) or `vercel rollback <deployment-url>`; undo with `vercel promote <deployment-url>`. Or Vercel dashboard → Production Deployment → Instant Rollback.
- **Database:** no down-migrations. Ship a forward-fix migration through the normal flow. Data loss → **Matthew:** Supabase point-in-time recovery (Dashboard → Database → Backups), after deciding the restore point.

## Platform settings (not in code — verify each release)

| Setting | Expected |
|---|---|
| GitHub branch protection `main` | PR required; checks `verify`, `api-tests`, `security`, `workflows` required; no force push |
| GitHub environment `production` | required reviewer: Matthew; secrets: VERCEL_TOKEN, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD |
| GitHub environment `staging` | secrets: SUPABASE_STAGING_*, VERCEL_AUTOMATION_BYPASS_SECRET |
| Vercel deployment protection | Vercel Authentication on previews; Protection Bypass for Automation enabled |
| Vercel Git | production branch `main`; Git deploys of `main` disabled in `vercel.json` |
| Supabase | staging branch exists (persistent); PITR enabled on production (plan permitting) |

## Secrets and rotation (Matthew)

| Secret | Created in | Stored in | Rotation order |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API keys | Vercel (prod, preview) | new key → Vercel → redeploy → verify → revoke old |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe dashboard | Vercel | roll key → Vercel → redeploy → verify → expire old |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | GHL → Settings → Private Integrations | Vercel | new token → Vercel → redeploy → verify → delete old |
| `VERCEL_TOKEN` | Vercel → Account → Tokens | GitHub `production` | new token → GitHub → re-run release smoke → delete old |
| `CRON_SECRET`, `VERCEL_AUTOMATION_BYPASS_SECRET` | generated / Vercel project | Vercel / GitHub `staging` | replace → redeploy → verify |

## Incidents

<date> · <what happened> · detected by <uptime / user / logs> · fixed by <rollback / fix PR> · follow-up <change>
