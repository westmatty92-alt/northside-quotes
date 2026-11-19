### BUG-<STEP>-<n> · <root cause or precise symptom>

| | |
|---|---|
| **Severity** | Critical / Important / Minor |
| **AC / tests** | AC-003.2 · `tests/e2e/booking.spec.ts › AC-003.2 slot taken shows next 3 slots` (mobile, desktop) |
| **Class hint → likely owner** | ui / server / contract / test / env / spec → bl-frontend / bl-backend / bl-architect / bl-qa / bl-devops / bl-pm |
| **Why that owner** | <e.g. API returns `next_slots` per contract (see response); screen doesn't render it> |
| **Signature suggestion** | `<layer>: <what is wrong, where>` |
| **Target** | <staging preview URL> @ <commit sha> |

**Steps to reproduce** (fresh QA tenant, signed in as `customer@tenantA`)
1. …
2. …

**Expected** — <quote the AC or the contract operation/status>
**Actual** — <what happened>

**Evidence**
- Trace: `.baseleap/reports/playwright-html/…/trace.zip` · Screenshot: `…png`
- Console: `<error lines>`
- Request: `POST /api/bookings` → `409` · `request_id: <id>` · body (trimmed): `{ "type": "slot_taken", … }`
- Reproduction (API): `curl -X POST "$BASE_URL/api/bookings" -H "Authorization: Bearer $TOKEN" -d '{…}'`
