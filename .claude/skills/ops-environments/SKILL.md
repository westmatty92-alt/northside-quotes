---
name: ops-environments
description: Environments as code for bl-devops — infra/environments.json declares every environment, branch, Supabase target, GitHub environment and environment-variable NAME with where it must exist; scripts/env-check.mjs compares that manifest with the code (env.ts, .env.example, process.env usage) and with what's actually set in Vercel (names only, via the API) to catch drift before a deploy. Terraform only by exception. Use when adding an env var, a service or an environment, and before every staging and production release.
---

# DevOps · Environments as Code & Drift

"Works on staging, breaks in production" is almost always a variable set in one place and not the other. The manifest is the single list of what each environment needs; the check proves reality matches it.

## 1. The manifest (`infra/environments.json`, template provided)

- **Environments:** production, staging, lane previews — with branch, Vercel target, Supabase project/branch ref, URL.
- **Variables:** for every name: `public` (only for `NEXT_PUBLIC_*`), `sensitive` (secret), where it's `required` / `optional` / `absent`, any branch-specific value rule (e.g. `NEXT_PUBLIC_API_MOCKING` = `on` only on `lane/frontend`), and **who sets the value** (always Matthew for secrets).
- **GitHub environments:** which secrets and variables CI needs in `staging` and `production`, and the production reviewers.
- **Smoke paths** for the release check.

The manifest holds **names and rules, never values**.

## 2. The drift check (`scripts/env-check.mjs`, template provided)

`node scripts/env-check.mjs [--vercel]` checks, and exits non-zero on any error:
1. Every `process.env.X` used in `src/` is in the manifest (no undeclared variables).
2. Every manifest variable is in `src/lib/server/env.ts`'s schema (server) or used as `NEXT_PUBLIC_*` (client), and in `.env.example` with an empty or placeholder value.
3. Secret-looking names are never `NEXT_PUBLIC_*`; `public` vars are only `NEXT_PUBLIC_*`.
4. With `--vercel` (needs `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`): reads the project's variables from the Vercel API **without decrypting** — names, targets, branches and type only — and reports each required name missing from an environment or branch, each name set where it must be absent, and secrets not stored as `sensitive`/`encrypted`.

Run it in the Phase 2 env step, before handing staging to QA, and in the release precondition list. A drift report is a ticket for Matthew (he sets values), not something you fix by guessing a value.

## 3. Config that is code

`vercel.json` (`ops-platform`), the workflows (`ops-ci`), `infra/environments.json` and `supabase/config.toml` are versioned and reviewed like application code. Dashboard-only settings that can't be code (GitHub branch protection, environment reviewers, Vercel deployment protection, the Supabase staging branch) are listed in `docs/runbook.md → Platform settings` with their expected values, and the Phase 2 step verifies them (read-only via `gh api` / the Vercel API).

## 4. Account setup packet (new client builds)

Your OPS-SETUP step (design phase, wave 1) turns `templates/account-setup.md` into `docs/ops/account-setup.md` for this client: fill every `{{…}}` from the PRD, the client research and the build plan (client name, owner decided at kickoff, repo, Vercel team/project, two Supabase projects, domain, DNS owner), and delete rows that don't apply. Provider keys you don't know yet stay out; they come later as setting requests once A1 names them. Names only, never values. The orchestrator opens the `account_setup` gate with it; nothing that needs the accounts runs until Matthew approves. After approval, your first pipeline step runs `env-check --vercel` and turns anything missing into a setting request, never a guess.

The human version of this process (with the reasons) is the SOP "Setting up a client project's hosting, database and release pipeline" in the Baseleap docs; keep the template in step with it.

## 5. Terraform / OpenTofu — by exception

Vercel + Supabase projects don't need Terraform: their config lives in the files above, and there's no other cloud infrastructure. Terraform is introduced only when the architect's decision record adds infrastructure beyond them (cloud storage, queues, DNS at scale) and after a spend gate. Then: remote state with locking, `fmt` + `validate` + `tflint` in CI, a `plan` posted for review, and **`apply` only by Matthew** (or a workflow behind the production environment approval). Never `apply` from an agent session.

---
Sources (ideas adapted, text written for Baseleap): takeaseatventure/devops-skills `env-drift-hunter` (MIT — compare variable sets across environments, missing-in-prod as the dangerous case, generating `.env.example`), alirezarezvani/claude-skills `env-secrets-manager` (MIT — env validation), antonbabenko/terraform-skill (Apache-2.0) and Jeffallan/claude-skills `terraform-engineer` (MIT) — fmt/validate/tflint, plan before apply, remote state locking — for the exception path. Vercel REST API docs (project environment variables).
