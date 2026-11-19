---
name: be-services
description: Business logic for bl-backend — put every rule in small service functions under src/lib/server/services, keep handlers thin, make writes idempotent, and change code surgically (smallest diff that meets the acceptance criteria, no speculative abstraction). Use whenever a step implements behaviour, and on every fix attempt.
---

# Back-End · Services & Discipline

Business rules are the part of the system most likely to be wrong and most expensive when they are. Keep them in one obvious place, small and tested.

## 1. Where logic lives

| Layer | Path | Does |
|---|---|---|
| Handler | `src/app/api/**/route.ts` | auth → validate → **one** service call → shape → map errors (`be-contract`) |
| Service | `src/lib/server/services/<resource>.ts` | the business rules for one resource: checks, calculations, orchestration of data + integrations |
| Data | inside the service, via the user-scoped client (`be-data`) | queries and RPC calls |
| Integrations | `src/lib/server/integrations/<provider>.ts` | Stripe, GHL, email — wrapped (`be-integrations`) |

Services take plain typed inputs (the session + validated data), return plain typed results, and throw **typed errors** (`SlotTakenError`, `NotFoundError`, `ForbiddenError`) that the handler maps to status codes. No `Request`/`Response` objects inside services — that's what makes them testable.

## 2. Rules come from the PRD, not from you

- Every rule you implement traces to an FR or acceptance criterion; name it in a comment only where the rule isn't obvious (`// AC-003.2: slot taken → offer next 3`).
- Money: integer cents end to end; totals, taxes and refunds computed on the server in one function each.
- Time: store and compare in UTC; convert to the client's time zone only where the PRD says a rule is local (e.g. "same-day cancellations").
- A rule the PRD doesn't settle → contract question / open question. Never invent business policy.

## 3. Idempotency

Anything that charges, sends or creates something a retry could duplicate:
- accepts an `Idempotency-Key` header (or uses the provider event id for webhooks),
- records the key with the result (a table the architect provides),
- returns the original result on a repeat instead of acting twice.

## 4. Surgical changes

- **Smallest diff that meets the acceptance criteria.** No features beyond the step, no abstractions for single-use code, no configurability nobody asked for.
- Don't "improve" adjacent code, comments or formatting; match the existing style. Unrelated problems you notice go in your report, not in your diff.
- Remove only what your change made unused.
- On a fix attempt: write (or point to) the test that reproduces the failure first, then make it pass — and change the approach if the previous attempt's approach failed.
- If 200 lines could be 50, rewrite it before reporting.

## 5. State assumptions

If the brief is ambiguous, list your assumptions at the top of your report — or, if a wrong guess would be costly, stop and ask through the report instead of picking silently.

---
Sources (ideas adapted, text written for Baseleap): alirezarezvani/claude-skills engineering core (MIT — service-layer separation), VoltAgent `backend-developer` (MIT — thin handlers, structured errors). multica-ai/andrej-karpathy-skills reviewed for ideas only (no licence file — think before coding, simplicity first, surgical changes, goal-driven verification; rewritten here).
