---
name: sec-audit
description: Security audit of an existing project for bl-security, not tied to one change — full-history secret scan of every repo (redacted), the access model and RLS as written, public endpoints and webhooks, edge functions, storage, dependency CVEs, the agent setup (sec-ai), and the live checks Matthew can run read-only (prepared as exact queries, never run by the agent). Use on a takeover or when asked for a whole-project security review.
---

# Security · Audit of an existing project

Same rubric and evidence rules as a review; the scope is the whole project instead of a diff.

## 1. What to run (read-only, on copies)
- **Secrets across full history** of every repo with Gitleaks (`--redact`), plus the working tree and any built bundle. Report file, commit, rule and secret type, never the value. A hit in history is a finding even if the file was deleted later (it's still in the clone); public repos are Critical.
- **Access model:** sec-access over the migrations and server code as written.
- **Public surface:** every public route, webhook, edge function and storage bucket: who can reach it and what stops abuse.
- **Dependencies:** sec-supply-chain on every lockfile.
- **Agent setup:** sec-ai section 2.
- **Live checks:** you never touch live systems. Write the exact read-only queries or screens Matthew (or the owning agent on a Go card) can use to confirm what the files can't show (live grants, RLS on, bucket visibility, function flags), with what a safe and an unsafe answer look like.

## 2. Output
`docs/security/audit.md` from `templates/audit.md` (findings ranked with the shared rubric, each with evidence and fix direction), `docs/security/live-checks.md`, and the secret findings feeding DevOps's rotation steps (`ops-secrets`).
