---
name: qa-fuzz
description: API contract and edge-case testing for bl-qa — black-box boundary and negative tests against the deployed API, plus a Schemathesis fuzz run that reads docs/openapi.yaml and sends every operation generated edge-case payloads, checking for server errors and responses that break the contract. Staging preview only. Use in Phase 3 after the lanes integrate, and on every re-run.
---

# QA · Contract Conformance & Fuzzing

The backend's own tests prove the cases its developer thought of. You find the ones nobody thought of, from the contract, against the deployed API.

## 1. Boundary and negative tests (`tests/e2e/api/*.spec.ts`)

From the test plan's **Boundaries** table, for each constrained input: min, max, just outside, empty, wrong type, null, unicode/emoji, very long, injection-looking strings (`' OR 1=1 --`, `<script>`). Expected outcome per the contract: 2xx for valid, **422** with the field named in `errors[]` for invalid — never 500, never a silently truncated or altered value. Malformed JSON → 400. Missing `Content-Type`, wrong method → the documented code.

**Explicit `null` for every optional field**, one at a time, on every write endpoint, in the black-box specs, not only in the fuzz run (Schemathesis runs on staging only, so the local run would miss it). A planted 500 on `notes: null` passed the sandbox suite until this existed.

## 2. Schemathesis fuzz run (`tests/fuzz/run.sh`, template provided)

Schemathesis (MIT) generates thousands of inputs from `docs/openapi.yaml` and checks every response.

```bash
uvx schemathesis run docs/openapi.yaml \
  --url "$BASE_URL/api" \
  --header "Authorization: Bearer $QA_CUSTOMER_TOKEN" \
  --header "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  --checks all \
  --phases examples,coverage,fuzzing,stateful \
  --exclude-path-regex "^/webhooks/" \
  --max-time 600 --max-response-time 3 \
  --report junit,har --report-dir docs/qa-reports/fuzz
```

- **Checks `all`:** no 5xx, responses conform to the schema, status codes documented, content types correct, and negative data rejected.
- **Stateful phase:** follows the contract's links (create → get → update → delete) so state-dependent bugs surface.
- **Run once per role** in the permission matrix (customer, staff…) with that role's token from the setup step.
- **Excluded by default:** webhooks (signature-verified, can't be fuzzed meaningfully), and any operation that sends real email/SMS or moves money unless the preview is wired to test mode and allow-listed recipients (check `docs/runbook.md`; if unsure, exclude it and say so in the report).
- **Budget:** `--max-time 600` per role. Use a fixed `--seed` when reproducing a failure; Schemathesis prints a `curl` reproduction for each failure — copy it into the bug ticket.

## 3. Reading the results

| Finding | Usually | Class |
|---|---|---|
| 500 on any input | missing validation or an unhandled error | `impl` → backend |
| response doesn't match the schema | backend returns extra/missing/wrong-typed fields | `contract` → backend |
| undocumented status code | backend improvised one | `contract` → backend |
| schema allows input the PRD forbids (or the reverse) | contract gap | `contract` → architect (contract question) |
| fails only on your side (bad token, wrong URL) | your setup | fix it yourself — not a bug |

Group findings by root cause: forty 500s from one missing null check is **one** ticket.

## 4. Safety

- `BASE_URL` must be the staging preview; the script refuses production hosts (same check as the Playwright config).
- Fuzzing writes data — it runs against the per-run QA tenant only, never a shared demo tenant.
- Never fuzz third-party APIs (Stripe, GHL) directly.

---
Sources (ideas adapted, text written for Baseleap): schemathesis/schemathesis (MIT — CLI usage from its docs: `--checks`, `--phases`, `--report`, stateful testing), charlieviettq `api-security-testing` (MIT — input abuse cases). borghei/Claude-Skills `api-test-suite-builder` reviewed for ideas only (Commons Clause — validating live payloads against the OpenAPI file; done here with Schemathesis and the generated Zod schemas instead of its `contract_validator.py`).
