---
name: sec-threat-model
description: Design-time threat model for bl-security — before Gate 2, read the architect's blueprint (architecture.md, SECURITY_MODEL.md, migrations, openapi.yaml, integration-contract.md) and ask how an attacker would steal data, skip a payment, cross tenants or take the system down; map every trust boundary where untrusted input enters (users, webhooks, provider data, uploaded files, AI/RAG content) and check the blueprint validates and authorises at each one. Also the differential mode used on every code review. Use for the design-phase security step and as the frame for every diff review.
---

# Security · Threat model and trust boundaries

Problems are cheapest to fix before code exists. In the design phase you review the blueprint; in the verify phase you review the diff against the same model.

## 1. Design phase (before Gate 2)
1. **Assets:** what an attacker wants (customer personal data, money and order totals, staff powers, provider tokens, other tenants' data, availability).
2. **Actors:** anonymous visitor, signed-in customer, each staff role, a compromised provider or webhook sender, a malicious uploaded file or document, an AI agent following injected instructions, an insider with a leaked key.
3. **Trust boundaries:** every place untrusted data crosses into the system: each API route, each webhook, each provider response, each file upload, each AI or RAG input, each admin tool. For each: who can reach it, how it authenticates, how it authorises (tenant and role), how it validates input, and what it may touch.
4. **Abuse cases:** for each Must story, the attacker version (read another tenant's order by changing an id; replay a webhook; set a price client-side; enumerate accounts; exhaust a rate limit to block real users).
5. **Verdict on the blueprint:** findings as contract questions to the architect (missing check, missing invariant, unsafe default), ranked with the shared rubric. Critical and Important block Gate 2 until answered.
Output: `docs/threat-model.md` from `templates/threat-model.md` plus the verdict in `.baseleap/reviews/<STEP>.md`.

## 2. Differential mode (every code review)
Read the diff **together with** the code it relies on: the auth helpers, the middleware or proxy, the RLS policies and the service the route calls. Ask what the change adds to the attack surface: a new route, a new boundary, a removed check, a new provider call, a widened permission, a new place secrets or personal data flow. A new endpoint without the tenant check that its neighbours have is the classic miss a scanner can't see. Update `docs/threat-model.md` when the diff adds a boundary.

Sources (ideas adapted, text written for Baseleap): trailofbits/skills `differential-review` and threat-modeling material (CC BY-SA 4.0 — ideas only, no text copied), Consensys/repo-security-review (no licence — ideas only), OWASP Threat Modeling Cheat Sheet.
