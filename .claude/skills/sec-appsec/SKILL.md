---
name: sec-appsec
description: Application-security review for bl-security — OWASP Top 10 and API Top 10 on the staging diff (injection, XSS, SSRF, unsafe uploads, insecure defaults, removed controls), seeded by Opengrep with Baseleap's own tested rules, eslint-plugin-security and the security scan runner, then confirmed by reading the code. Use on every security-review step.
---

# Security · OWASP & Vulnerability Review

Tools find candidates; you decide what's real. Run the scan, then read every boundary where untrusted data enters.

## 1. Run the scan

`scripts/security-scan.sh <base> <head> <STEP>` (template: `templates/security-scan.sh`) runs, writing raw JSON to `.baseleap/reviews/<STEP>/`:
- **Opengrep** (LGPL-2.1, Semgrep-compatible) with `.opengrep/baseleap.yml` (template: `templates/opengrep-baseleap.yml`) — Baseleap's own rules for this stack, run with `--taint-intrafile` so tainted input is followed across functions in a file.
- **Gitleaks** and **dependency** scans (see `sec-secrets`, `sec-supply-chain`).

Generic JavaScript security lint comes from **`eslint-plugin-security`** (Apache-2.0) inside `npm run lint`; its findings are inputs like any other scanner hit.

**No Semgrep registry rule packs, ever.** Their licence (Semgrep Rules License v1.0) forbids distributing the rules or offering them as a service, which Baseleap does. Coverage grows the other way: when you confirm a new kind of bug, propose a new Baseleap rule plus a fixture case in `tests/fixture-repo/` (mark the line `// expect: <rule-id>`), and run `node .claude/skills/sec-appsec/tests/check-rules.mjs` — it must report PASS before the rule is used.

A tool that didn't run is **not assessable**, never "passed".

## 2. Read every entry point

List the entry points the diff adds or changes (route handlers, server actions, webhooks, cron routes, embed pages, forms) and for each trace untrusted input to where it's used:

| Class | Look for in this stack |
|---|---|
| **Injection** | string-built SQL in RPC/`sql` calls; `.or()`/`.filter()` strings built from input; `child_process`/`exec`; template engines on user input |
| **XSS** | `dangerouslySetInnerHTML`, `href={userInput}` (`javascript:` URLs), markdown/HTML rendered unsanitised, user content in emails |
| **SSRF** | `fetch(url)` where any part of the URL comes from the request or the database (image proxies, webhooks the user configures, "import from URL") — needs an allow-list |
| **Uploads** | type checked by content not extension, size limit, stored in a private bucket, served with safe `Content-Type`/`Content-Disposition`, no path from user input |
| **Insecure defaults** | CORS `*`, `frame-ancestors` missing or `*` on embed routes, `postMessage(…, '*')`, verbose errors in production, debug routes left in, permissive storage bucket policies |
| **Crypto & tokens** | `Math.random` for tokens, home-made signing, JWTs verified without checking algorithm/expiry, comparing secrets with `===` (use timing-safe compare) |
| **Open redirect** | `redirect(searchParams.get('next'))` without an allow-list |
| **Prompt injection** | user or third-party text passed into an AI prompt with tool access or used to decide permissions |

## 3. Removed controls

Because this is a diff, check what was **taken away**: deleted auth checks, loosened validation, a removed RLS policy or `force row level security`, a dropped rate limit, a widened CORS/CSP. A removed control is Critical until the diff shows an equal replacement.

## 4. Variants

When you confirm a bug, search for the same pattern elsewhere in the repo (same function, same misuse) — one confirmed injection usually has siblings. Report them as one finding with all locations.

## 5. Each confirmed issue

Exploit scenario in one sentence, the exact line, the fix direction, and a regression test the owner should add. Severity per `review-verdict`.

---
**Differential mode:** review the diff together with the auth helpers, proxy, RLS policies and services it relies on (`sec-threat-model` §2). A new route missing a check its neighbours have is the finding scanners miss.

Sources (ideas adapted, text written for Baseleap): trailofbits/skills `static-analysis`, `insecure-defaults`, `variant-analysis`, `differential-review` (CC BY-SA 4.0 — ideas only, no text reused), trilwu/secskills core/defense (MIT — OWASP checks, crypto checks, remediation guidance), Consensys/repo-security-review (no licence file — ideas only: diff-scoped mode, removed security controls), opengrep/opengrep (LGPL-2.1 engine), eslint-community/eslint-plugin-security (Apache-2.0); Semgrep registry rules deliberately not used (Semgrep Rules License — see §1).
