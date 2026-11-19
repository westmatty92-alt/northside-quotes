---
name: int-new-provider
description: The any-provider method for bl-integration (I18) — for a system no skill knows (a POS, an ERP, a niche CRM, a legacy SOAP/SFTP feed), research the official docs, fill a provider profile with unknowns marked "to confirm", then build the wrapper, simulator and tests the same way as every other provider.
---

# Integration · Any new provider

No provider is hard-coded. Every new system goes through these steps, in order.

## 1. Read the official docs, and only the official docs
- Sources in order: the provider's developer site → their published OpenAPI or Postman collection → their official SDK repo → Context7. Blogs, aggregators and AI summaries **don't count** (use them only to find the official page).
- JavaScript-rendered docs (e.g. Loyverse's API reference) come back empty from a page fetch. Render them with `node scripts/read-docs.mjs <url> --out .baseleap/docs/<provider>-<page>.txt` (headless Chromium, visible text only, no sign-in) and cite the URL. If that fails too, say so in the report. Never fill gaps from memory.
- Some official help centres block page fetches (robots). Note the blocked URL; don't retry through a mirror or cache.
- Record every source URL with the date read.

## 2. Fill the provider profile (`docs/integrations/<provider>.md`, top section, from `templates/provider-profile.md`)
Base URL and versioning · auth types (and which one we use, with scopes) · token lifetime and refresh rules · rate limits and the 429 behaviour · pagination · webhooks (events, how they're signed, retries) · idempotency support · sandbox or test mode · OpenAPI/SDK availability · data residency · terms that limit use (e.g. "only on sites you own" clauses, like the Garet webfont licence).
**Anything the docs don't state is written as `TO CONFIRM: <question>`**, never guessed, and listed in the report for Matthew or the provider.

## 3. Choose the adapter shape
| The provider offers | We build |
|---|---|
| REST / GraphQL | the standard wrapper (`int-providers`) |
| Webhooks | `int-webhooks` with its signature scheme, or the unsigned-provider pattern |
| Polling only | a scheduled sync with a cursor (`int-sync`) |
| SOAP / XML | a wrapper that builds and parses XML at the boundary; the rest of the app sees our types only |
| SFTP / CSV / EDI files | a scheduled job that fetches, validates (row counts, checksums, schema) and imports idempotently by file name + hash. **An SFTP server or VPN is new infrastructure → spend or scope gate** |
| On-prem database | **Gate 1 decision** (VPN or agent), never improvised |

## 4. Then the usual
Simulator and fixtures (`int-testing`), contract tests, the integration-contract rows (raise a CONTRACT QUESTION if the architect's contract doesn't cover it), the runbook, and the registry row.

## 5. Report
The profile's TO CONFIRM list, the auth choice and why, any terms that restrict use, and anything needing a gate.

---
Sources: Matthew's instruction (Nov 15: "able to do any integration"), the I18 decision, the Loyverse drill (INT1, Nov 15) as the worked example. Kit research notes are not installed in client repos, so never cite them as evidence.
