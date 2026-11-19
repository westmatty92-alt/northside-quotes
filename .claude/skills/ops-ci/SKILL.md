---
name: ops-ci
description: CI/CD pipelines for bl-devops — GitHub Actions workflows for verification on every lane, staging and PR (typecheck, lint, tests, build, generated-code guard, API tests on the staging branch, security scan with pinned and checksum-verified scanners, workflow lint), QA smoke on every staging deploy, and the hardening rules every workflow follows (least-privilege permissions, pinned actions, no untrusted triggers). Use when creating or changing anything in .github/workflows.
---

# DevOps · CI/CD Pipelines

CI is the ledger's outside witness: the same checks the agents ran, re-run on a clean machine on every push. If CI and an agent disagree, CI is right.

## 1. Workflows (templates in `templates/`)

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push to `staging`, `lane/**`; PRs to `staging`/`main` | **verify** (install, typecheck, lint, unit/component tests, build, generated-code guard) · **api-tests** (backend's `tests/api` on the staging Supabase branch) · **security** (`scripts/security-scan.sh`) · **workflows** (actionlint) |
| `qa-staging.yml` | Vercel reports a successful deployment of `staging` | QA's `@smoke` Playwright run against that exact deployment URL; uploads the report |
| `staging-migrations.yml` | push to `staging` touching `supabase/migrations/**` (or the workflow itself) | applies migrations to the **staging** Supabase project via its session-pooler connection string (no access token); refuses a production ref or host |
| `release.yml` | push to `main` (after Gate 3) | see `ops-release` — migrate → deploy → smoke → auto-rollback |
| `uptime.yml` | every 15 min | see `ops-observe` |

`main` is protected: changes only by PR from `staging`, with `verify`, `api-tests`, `security` and `workflows` as **required status checks**. No direct pushes, no force pushes.

## 2. Speed without shortcuts

- `actions/setup-node` with `cache: npm` and `npm ci` (lockfile-exact installs).
- `concurrency` per ref with `cancel-in-progress` for CI (never for releases).
- Jobs run in parallel; `timeout-minutes` on every job.
- The scanners are installed by `scripts/install-scanners.sh` (template) at pinned versions, each verified against its published SHA-256 before use — the same versions and checks used on Matthew's machine.

## 3. Hardening rules (every workflow)

- **`permissions:` declared at the top, least privilege** (`contents: read` by default; widen per job only when needed, e.g. `issues: write` for uptime).
- **Pin third-party actions to a full commit SHA** with the version in a comment (`uses: actions/checkout@<sha> # v4`); the templates use tags only until the build session pins them.
- **Never `pull_request_target`** or workflows that check out untrusted PR code with secrets.
- **No untrusted input in `run:`** — `github.event.*` text (PR titles, branch names) goes through `env:` variables, never inline `${{ }}` in a shell line.
- Secrets only through `secrets.*` in jobs bound to a GitHub **environment** (`staging`, `production`); never echoed; `set -x` never used in steps that touch them.
- `actionlint` passes on every workflow (the `workflows` job enforces it).

## 4. When CI breaks

Read the failing step's log first, reproduce the exact command, and classify like `stack-triage`: a real failure goes back to the step owner as a ticket; a CI-only failure (cache, runner image, tool download, missing env var name) is yours — fix the pipeline, never weaken or skip the check. A flaky check is reported, not retried until green.

---
Sources (ideas adapted, text written for Baseleap): akin-ozer/cc-devops-skills `github-actions-generator`/`github-actions-validator` (Apache-2.0 — actionlint, pinned versions), alirezarezvani/claude-skills `ci-cd-pipeline-builder` (MIT — lint/test/build/gated deploy stages, caching), Jeffallan/claude-skills `devops-engineer` (MIT). borghei/Claude-Skills `ci-cd-pipeline-builder` reviewed for ideas only (Commons Clause).

## Auto-commit jobs
Any job that commits or pushes by itself (a docs auto-sync, a bot) runs `templates/pre-commit-secrets.sh` (as `scripts/pre-commit-secrets.sh`) right before its commit. A non-zero exit means don't commit and alert a human. Pair it with GitHub push protection on the repo.
