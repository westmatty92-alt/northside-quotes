---
name: sec-secrets
description: Secrets and data-privacy review for bl-security — Gitleaks over the diff's commits, the working tree and the built client bundle with Baseleap's config (Supabase, Stripe, GHL keys), env-var hygiene (server-only names, .env never committed, NEXT_PUBLIC_ limits), and personal data kept out of logs, errors, fixtures and analytics. Use on every security-review step.
---

# Security · Secrets, Credentials & Data Privacy

A leaked key is a breach the moment it's pushed, even if the next commit deletes it. Look in history, not just the current files, and in what ships to the browser.

## 1. Scan (via `scripts/security-scan.sh`)

Gitleaks with `.gitleaks.toml` (template: `templates/gitleaks.toml`, which extends the default rules with Supabase, GHL and Baseleap patterns):
- **History:** every commit in the review range (`gitleaks git --log-opts=<base>..<head>`).
- **Working tree:** `gitleaks dir .`.
- **Client bundle:** `gitleaks dir .next/static` after `npm run build` — anything there is public.
Always `--redact`. Results go to `.baseleap/reviews/<STEP>/gitleaks-*.json`.

## 2. Read for what scanners miss

- `.env*` files committed (only `.env.example` with **names and placeholder values** is allowed).
- Secrets assembled from parts, base64-encoded, or in test fixtures and seed files.
- Server env vars read in files that can end up in the client (`'use client'` files, shared modules without `import 'server-only'`).
- `NEXT_PUBLIC_*` used for anything but the URL and anon/publishable keys the architecture lists.
- Keys in `vercel.json`, GitHub workflow files, docs, screenshots, or `.baseleap/` reports.

## 3. Personal data

- **Logs:** no request bodies, tokens, cookies, emails/phones in full, or provider error objects that contain them. Structured logs carry ids, not personal data.
- **Errors:** responses never echo internal ids, SQL, stack traces or other users' data.
- **Analytics:** events carry only the properties `docs/metrics-spec.md` lists; no emails or names in event properties or URLs.
- **Fixtures and seeds:** made-up data only.

## 4. When you find a secret

Never print it. Report `file:line` (or commit SHA), the secret **type**, whether it reached a remote or a deployed bundle, and mark it **Critical — rotate**. Removing it from the code is required but not sufficient; the key must be rotated by Matthew (a gate brief item), and history may need cleaning — the orchestrator raises that as an escalation, not something you or a developer does alone.

---
Sources (ideas adapted, text written for Baseleap): gitleaks/gitleaks (MIT — git/dir scanning, config extension, redaction), Consensys/repo-security-review (no licence file — ideas only: env-var hygiene and sensitive-data exposure phases), trilwu/secskills (MIT — sensitive data exposure checks).
