---
name: int-testing
description: Proof for bl-integration — contract tests on recorded provider fixtures, idempotency and signature drills, outage drills (timeouts, 429 storms, 500s, revoked tokens), drift detection, and deterministic provider simulators in tests/mocks/ that QA reuses offline (I12). No live provider calls without spend_approval, and only in test modes.
---

# Integration · Testing & simulators

## 1. What every provider gets (`tests/integrations/<provider>/`)
| Test | Proves |
|---|---|
| **Contract** | The wrapper parses recorded responses (`fixtures/*.json`, secrets scrubbed). Our mapping produces our types. A changed provider field fails **naming the field** (drift). |
| **Signature** | A valid signature is accepted. A tampered body, wrong secret, missing header or stale timestamp → 401, and **nothing is stored**. |
| **Idempotency** | The same webhook delivered 3 times → 1 record and 1 job. An outbound create retried after a timeout → 1 object at the provider (same idempotency key). |
| **Outage** | Timeouts and 500s → retried with backoff, then queued. A 429 storm → backoff honouring `Retry-After`. 5 failures → breaker opens and work is queued. Revoked token → `needs_reconnect`, sync paused, no crash loop. |
| **Order** | An older event arriving after a newer one is ignored. |
| **Redaction** | Logs captured during the tests contain no token, secret or personal field. |

## 2. Simulators (`tests/mocks/<provider>/`, from `templates/simulator.mjs`)
- A tiny local HTTP server (Node, no dependencies) that answers the wrapper's routes from fixtures. Its **mode** is set by header or env: `ok`, `slow` (sleep past the timeout), `429` (with `Retry-After`), `500`, `revoked` (401), `drift` (a renamed field).
- It sends signed webhooks to our route, including a replay mode (same event N times) and an out-of-order mode.
- When the provider publishes OpenAPI (Stripe: github.com/stripe/openapi; GHL: research/integration/ghl/apps/*.json), Prism can serve the happy path, with the simulator adding the failure modes.
- QA runs its failure drills against these simulators with **no network access**. Document how in `docs/integrations/<provider>.md`.

## 3. Live calls
Only provider test modes (Stripe test keys, the QuickBooks sandbox, GHL test sub-account), only behind `spend_approval`, never from CI by default, and never against a client's live account.

## 4. Verify command
`npm run typecheck && npm run lint && npm test -- tests/integrations/<provider> && npm run build`

---
Sources (ideas adapted, text ours): alirezarezvani api-test-suite-builder (MIT), Standard Webhooks spec (Apache-2.0), Prism (Apache-2.0), Matthew's blueprint (simulators for QA, Nov 15).

## Prove the tests actually run

Before claiming a pass, check that the project's test config matches your test files (`vitest list` or the config's `include`). If it doesn't, say so in the report as a contract question for the architect and show a run with a throwaway config outside the repo. Never edit a config you don't own, and never report "`npm test` passes" for tests it didn't run.
