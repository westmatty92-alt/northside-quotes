---
name: qa-probe
description: Permission-boundary probing for bl-qa — black-box tests on the staging preview that try to cross every line in SECURITY_MODEL.md, as two tenants and every role, through the app's API and directly through Supabase's REST API with a user's own token — cross-tenant ids (BOLA/IDOR), role escalation, mass assignment, missing auth, rate limits, and stored-XSS rendering. Use for every permission row in the test plan.
---

# QA · Permission Boundary Probes

The backend tests its own permission matrix in-process. You attack it from outside, on the deployed app, the way a curious or malicious user would. These are functional checks of the boundaries — the deeper security review is `bl-security`'s job in Phase 4.

## 1. The cast (created by the setup step on the staging branch)

Two tenants, **A** and **B**, each with one user per role in the permission matrix, plus records in each. All probes run as one of these users or as nobody.

## 2. Probes (`tests/e2e/api/permissions.spec.ts`)

| Probe | How | Expected |
|---|---|---|
| **No auth** | every protected operation with no cookie/token | 401 |
| **Cross-tenant read (BOLA/IDOR)** | B's user requests A's record ids (get, update, delete, nested routes, list filters like `?customer_id=`) | 404 — and nothing of A's in any list |
| **Role escalation** | lowest role calls staff/admin operations; changes its own role field | 403; role unchanged |
| **Mass assignment** | send fields the contract doesn't allow on writes (`operator_id`, `role`, `status: "paid"`, `price`) | 422 or ignored — re-read shows the field unchanged |
| **Direct database access** | call Supabase's REST endpoint (`$SUPABASE_URL/rest/v1/<table>`) with the anon key **and B's own access token**, for every table: select A's rows, insert into A's tenant, update A's rows | RLS returns nothing / denies — this is the check that the database itself holds even if the API is bypassed |
| **Rate limits** | burst the operations `SECURITY_MODEL.md` rate-limits (sign-in, public forms, sends) | 429 with `Retry-After` at the documented threshold |
| **Stored XSS** | save `<img src=x onerror=window.__xss=1>` and `"><script>window.__xss=1</script>` in every free-text field, then open every screen that shows it | renders as text; `window.__xss` stays undefined |
| **Embed handoff** | open an embed route with a tampered or unsigned location/contact id | rejected, no data shown |
| **Secrets in the client** | search the deployed JS bundles and HTML for `service_role`, `sk_live`, `sk_test`, private keys | none found |

## 3. Rules

- Probe only the staging preview and the QA tenants. Never production, never real client data, never third-party services.
- A boundary that holds by accident (e.g. 500 instead of 404) is still a finding — the error leaks that the record exists and the code path is unhandled.
- Any probe that **crosses** a boundary is **Critical**: stop the rest of the run's reporting, write the ticket first, and flag it at the top of your report — the orchestrator holds the release gate on it.
- Don't try to exploit further than proving the boundary is crossed (no data exfiltration scripts, no destructive payloads beyond the QA tenants).

---
Sources (ideas adapted, text written for Baseleap): charlieviettq/awesome-agent-skill `api-security-testing` (MIT — horizontal/vertical authorisation, IDOR, mass assignment, rate-limit bypass, injection), trilwu/secskills (MIT — authentication boundaries, session handling, input sanitisation checks; offensive techniques beyond boundary checks deliberately left out).
