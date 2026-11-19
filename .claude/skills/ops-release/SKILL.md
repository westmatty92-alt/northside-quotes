---
name: ops-release
description: Releases for bl-devops — after Gate 3 only, ship staging to production through the release workflow behind a GitHub production environment that Matthew approves — migrations first (expand/contract so old and new code both work), then a prebuilt Vercel production deploy, a read-only smoke check, automatic Instant Rollback on failure, and a release-log entry. Also how database changes are rolled back (forward fixes). Use for every deploy-phase step and every production incident.
---

# DevOps · Migrations & Zero-Downtime Releases

Shipping should be boring: the same scripted steps every time, two human approvals, and a one-command way back.

## 1. Preconditions (the deploy step's brief must show all of these)

- **Gate 3 · release_approval** resolved by Matthew in the ledger.
- Both review verdicts APPROVED, QA verdict PASS on the exact `staging` commit being shipped.
- The migrations to be applied are **named in the Gate 3 packet** (`supabase migration list` diff for production).

If any is missing, stop and report — never ship "nearly approved".

## 2. The release (template: `templates/release.yml`)

1. You open the PR `staging → main` (`gh pr create`), with the Gate 3 packet summary, migration list and rollback plan in the body. Required checks must pass; you merge only after they do.
2. The push to `main` starts `release.yml`. Its single job runs in the GitHub **`production` environment**, which has Matthew as **required reviewer** — the workflow waits until he approves in GitHub. This is the mechanical human gate before anything live changes; you cannot approve it.
3. **Migrate:** `supabase db push --dry-run` (list printed to the log) → `supabase db push`.
4. **Deploy:** `vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod` (exactly the commit that was approved).
5. **Smoke (read-only):** `/api/health` returns OK **and** reports the new commit SHA; every path in `infra/environments.json → smokePaths` returns 200. No writes, no test users, no QA suite on production.
6. **On smoke failure:** `vercel rollback` to the previous production deployment automatically, mark the run failed, and report — the orchestrator opens an escalation.
7. **Record:** append to `docs/deployments/release-log.md` (template) — date, commit, deployment URL/id, migrations applied, smoke result, rollback command — via a PR to `staging` so it flows back on the next release.

## 3. Database changes that can't break a live app

Code and schema deploy separately, so every migration must work with **both** the old and the new app version:

| Change | Do it as |
|---|---|
| Add column/table | add nullable or with default — safe |
| Rename column | add new → backfill → keep both in sync (trigger) and the app moves to new → (next release) move every function/trigger/view/policy that names the old column, then drop it (`be-data` §6) |
| Drop column/table | release 1: app stops using it · release 2: drop it |
| Make column NOT NULL | backfill first, add constraint `NOT VALID`, then `VALIDATE CONSTRAINT` |
| Large index | `create index concurrently` (in its own migration, outside a transaction) |
| Backfill big tables | batched job, not one migration statement |

A migration that breaks this rule is a finding for the architect before Gate 3, not something to "be careful" with at release time.

## 4. Rolling back

- **App:** `vercel rollback` (instant; re-points production to the previous deployment, no rebuild). Undo with `vercel promote <deployment>`. Matthew runs these from the runbook; the release workflow runs rollback automatically on smoke failure.
- **Database:** no down-migrations on production. Because migrations are expand/contract, the previous app version still works on the new schema; problems are fixed with a **new forward migration** through the normal flow. Data-destroying mistakes → Supabase point-in-time recovery, which is Matthew's call (escalation).

## 5. Pipeline drills before launch (every new client build)

The release and its rollback are proven on the client's real accounts **before the client goes live**, while production has no users. Keep `docs/ops/pipeline-drills.md` from `templates/pipeline-drills.md`: one row per attempt, failures included with their fix, and whether the fix also went into the kit template.
- Drills: CI on staging · staging tests start by themselves · release (approval → migrations dry run then apply → deploy → live check) · **rollback** (a planted production-only failure must be replaced automatically) · expand/contract · uptime alert · guardrails.
- **Launch is blocked until release and rollback pass.** The deploy step's preconditions (§1) cite the drill log.
- Planted breaks are listed in the log and reverted in the next PR. Matthew approves every production step; if an automatic rollback fails, stop, ask Matthew to restore production from the Vercel dashboard (Instant Rollback), then fix forward.
- Re-run release and rollback after any change to `release.yml`, the account setup, or the tools the release installs.
- Every lesson goes back into the kit (template + `build-specs/decisions.md`), so the next client starts from the fixed version.

## 6. Never

- Deploy production outside the release workflow, or before Gate 3.
- Run `supabase db push` against production yourself, or migrations not named in the Gate 3 packet.
- Approve the GitHub production environment, change its reviewers, or disable branch protection.

---
Sources (ideas adapted, text written for Baseleap): Vercel docs (`vercel promote`, `vercel rollback`, prebuilt deploys from CI), Supabase CLI docs (`db push`, migration list), Jeffallan/claude-skills `devops-engineer` references `deployment-strategies.md` + `release-automation.md` (MIT — rollback procedures, gated releases), alirezarezvani/claude-skills `migration-architect` (MIT — expand/contract, zero-downtime schema changes). borghei/Claude-Skills `release-manager`/`migration-architect` reviewed for ideas only (Commons Clause).
