---
name: ops-secrets
description: Secrets and access hygiene for bl-devops — you handle secret NAMES, Matthew sets VALUES; where each secret lives (Vercel sensitive variables, GitHub environment secrets), least-privilege and short-lived tokens, never reading or printing values, .env.example generation, and the rotation runbook. Use whenever a step touches credentials, tokens, environment variables or access settings.
---

# DevOps · Secrets & Access

You never need a secret's value to do your job. You declare what's needed, verify it's present and correctly protected, and tell Matthew exactly what to set where.

## 1. Who does what

| Action | You | Matthew |
|---|---|---|
| Declare a variable (manifest, `env.ts`, `.env.example`) | ✅ | |
| Set or change a secret value (Vercel, GitHub, Supabase, Stripe, GHL) | ❌ | ✅ |
| Verify presence/type/targets (names only) | ✅ `env-check --vercel`, `gh secret list` | |
| Create tokens and API keys | ❌ | ✅ |
| Rotate after a leak | prepare the checklist | ✅ executes |

When something must be set, write a **setting request** in your report: name · where (Vercel env + target/branch, or GitHub environment) · type (sensitive) · what the value is (e.g. "Stripe test-mode secret key for the client's sandbox account") · why. Never a value, never a guess.

## 2. Where secrets live

- **Runtime secrets:** Vercel environment variables, added as **Sensitive** (write-only after saving), scoped to the right target and branch.
- **CI secrets:** GitHub **environment** secrets (`staging`, `production`) — not repository-wide — so only jobs bound to that environment can read them, and production secrets are only available after Matthew's approval.
- **Non-secret identifiers** (project ids, refs, URLs): GitHub environment **variables**, not secrets.
- **Never:** in code, `vercel.json`, workflow files, `.env` files in the repo, test fixtures, `.baseleap/` reports, logs or PR text.

## 3. Least privilege

- `VERCEL_TOKEN` scoped to the client's team with the shortest practical expiry; `SUPABASE_ACCESS_TOKEN` from an account with access to that client's project only; Stripe restricted keys where the API allows; GHL private integration tokens with only the scopes the PRD needs.
- Workflows declare minimal `permissions:`; the default `GITHUB_TOKEN` is read-only.
- Agents get **no** production credentials. Your session uses the read-only paths (Vercel API listing without decryption, `gh` reads); anything that writes to production runs in the approved release workflow.

## 4. Commands you must not run

`vercel env pull`, `vercel env add/rm`, `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel rollback`, `supabase db push` (production), `gh secret set/delete`, `gh api` calls that change environments, protection rules or secrets, `printenv`/`env` dumps, reading `.env*` files other than `.env.example`. The project's `.claude/settings.json` denies them; if one is needed, it's Matthew's step in the runbook.

## 5. Rotation (runbook section you maintain)

Keep `docs/ops/secret-inventory.md` from `templates/secret-inventory.md`: every secret by name, what it unlocks, its scope, every place it lives, who created it and when it was last rotated. On an existing project, build it during the takeover. Each rotation gets click-by-click steps written for a non-developer.


For each secret: where it's created, where it's stored (every place), what breaks while rotating, and the order (create new → store everywhere → redeploy → verify → revoke old). A leaked secret (from `bl-security`) is rotated first and cleaned from history second — both are Matthew's actions, prepared by you as a checklist.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills `env-secrets-manager` (MIT — secret store wiring, validation, rotation policy), takeaseatventure/devops-skills (MIT — env hygiene), Vercel docs (sensitive environment variables, branch-specific variables), GitHub docs (environment secrets, required reviewers). borghei/Claude-Skills `env-secrets-manager` reviewed for ideas only (Commons Clause).
