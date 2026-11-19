---
name: ops-platform
description: Hosting platform setup for bl-devops — the Vercel project as code (vercel.json with security headers, embed frame-ancestors, crons, production Git deploys turned off), the branch model (main = production, staging = integration, lane/* = previews), preview protection with the automation bypass, and when (rarely) a container is justified. Use on the first DevOps step of every project and whenever hosting config changes.
---

# DevOps · Platform & Environments

Client stacks run on Vercel (Next.js) + Supabase. That's managed, serverless and already reproducible — so the job is to configure it as code and keep every environment predictable, not to build infrastructure.

## 1. Branches → environments

| Branch | Vercel | Supabase | Used by |
|---|---|---|---|
| `main` | **Production** — deployed only by the release workflow (`ops-release`), never by a Git push | production project | client's customers |
| `staging` | Preview (branch URL is the stable staging URL) | the persistent staging branch (architect D6) | QA, reviewer, security, Matthew |
| `lane/frontend` | Preview with `NEXT_PUBLIC_API_MOCKING=on` | none needed (mocks) | frontend's own verification |
| `lane/backend` | Preview | staging branch | backend's own verification |

Branch-specific preview variables carry the differences (`ops-environments`); nothing is switched by editing code.

## 2. `vercel.json` (template: `templates/vercel.json`)

- **`git.deploymentEnabled: { "main": false }`** — production is never deployed by a push; only the approved release workflow deploys it, after migrations.
- **Security headers** on every route: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors 'none'` for app routes.
- **Embed routes** (`/embed/*`) get `frame-ancestors` with exactly the GHL domains in the architect's decision record (the client's white-label domain included) — never `*`.
- **Crons** for scheduled jobs from `arch-reliability`; every cron route checks `Authorization: Bearer $CRON_SECRET`.
- **Region** close to the client's Supabase region (latency between them matters more than to the user).
- Long-running routes set `export const maxDuration = …` in the route file (house cap 300 s), not globally.

## 3. Preview protection

Previews stay protected (Vercel Authentication). QA and CI reach them with **Protection Bypass for Automation**: the secret is created by Matthew in the Vercel project, stored as the `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secret, and sent as the `x-vercel-protection-bypass` header.

## 4. Containers, Kubernetes, Terraform — by exception only

The default stack needs none of them. They're justified only when the architect's decision record names a component Vercel can't run (a long-running worker, a WebSocket server, a self-hosted service). Then:
- a spend gate first (new hosting = new monthly cost);
- a multi-stage `Dockerfile` on a pinned, minimal base image (by digest), running as a non-root user, no secrets in layers, a `HEALTHCHECK`;
- deployed to a managed container host named in the decision record, with the same release rules (`ops-release`).
Never add these "for reproducibility" on a plain Vercel + Supabase project — they become unowned infrastructure.

---
Sources (ideas adapted, text written for Baseleap): Vercel docs (Git deployment settings, preview protection bypass, branch URLs, crons), akin-ozer/cc-devops-skills `dockerfile-generator`/`dockerfile-validator` (Apache-2.0 — multi-stage, non-root, pinned base), takeaseatventure/devops-skills `dockerfile-auditor` (MIT — layer and security smells), Jeffallan/claude-skills `devops-engineer` (MIT).
