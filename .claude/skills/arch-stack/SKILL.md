---
name: arch-stack
description: Tech stack and trade-off selection for bl-architect — start from the Baseleap house stack, deviate only for a named requirement, right-size (monolith first), and record every real choice as a numbered decision record. Use first in every architect blueprint step.
---

# Architect · Stack & Decisions

Boring, proven, and already understood by the rest of the team beats clever. Every deviation from the house stack costs the frontend, backend, devops and security agents something — so it needs a reason that comes from the PRD.

## 1. The house stack (default for client apps)

| Layer | Default | Notes |
|---|---|---|
| App | Next.js (App Router) + TypeScript (strict) | One deployable: UI + route handlers |
| UI | Tailwind + shadcn/ui, theme generated from `DESIGN.md` → `src/app/theme.css` | Designer owns `DESIGN.md` |
| Data | Supabase Postgres, **RLS on every table**, SQL migrations in `supabase/migrations/` | No ORM schema as source of truth |
| Auth | Supabase Auth (email/magic link; OAuth if the PRD needs it) | GHL-embedded modules: see `arch-security` §4 |
| Hosting | Vercel (preview per branch, production from `main`) | Testing happens on Vercel previews, never only locally |
| Payments | Stripe | Webhooks verified server-side |
| CRM | **Baseleap CRM — custom software on this stack** (decided Nov 11 2026) | GHL is used only for websites and marketing (pages, forms, campaigns), integrated through API v2 / webhooks. Embed a screen in a GHL page only when the PRD says it lives on a marketing page. |
| Automation | n8n (Baseleap Automate) | Only when the PRD needs workflows outside the app |

Deviate only when a PRD requirement makes the default wrong (e.g. long-running jobs beyond Vercel's function limit → a queue or worker; heavy realtime → Supabase Realtime or a dedicated service). Every deviation gets a decision record.

## 2. Right-size

- **Monolith first.** One Next.js app until there's a second *deployable* (a separate worker, an embeddable widget shipped to other sites, a public SDK). Then — and only then — a workspace monorepo (Turborepo), with its own decision record.
- **No microservices for v1.** If the PRD seems to need them, it's a scope question for Matthew, not an architecture default.
- **Managed over self-hosted.** Every self-hosted piece is a devops step and an ongoing cost.
- **Cost is a requirement.** Anything with a recurring bill (new SaaS, plan upgrade, Supabase branch, Redis, monitoring) is named in the decision record and flagged in the report — the orchestrator opens a `spend_approval` gate.

## 3. Decision records (`docs/decisions/NNNN-<slug>.md`)

Write one whenever there were real alternatives — stack, auth approach, data ownership, sync strategy, tenancy model, anything the PRD's "stop and escalate" list touches. Not for trivia.

Use `templates/decision.md`. Rules:
- Numbered, never renumbered; `docs/decisions/README.md` is the index (number · title · status · date) and lists **every** file in the folder.
- **The folder is shared with the orchestrator.** Intake decisions (build mode, scope calls Matthew made) may already be there as `0001`…: they are locked. Don't edit or renumber them. Number yours after the highest existing one, and name the stack record `NNNN-stack.md`. Cite intake decisions by number; don't restate them.
- **Status:** `proposed` while you work → becomes `locked` when Matthew approves Gate 2 (the orchestrator sets it). A locked decision is changed only by a **new** record that supersedes it.
- Alternatives are real ones with an honest "why not" — not strawmen.
- Consequences include the negatives and the risks.
- Link it: which PRD sections (FR-n) drove it, which migrations/contract paths implement it.

A `NNNN-stack.md` is always written (numbered after any intake decisions): house stack confirmed or deviations listed.

## 4. Research before deciding

When a decision depends on how a library, API or platform behaves *now* (GHL API limits, Supabase features, Next.js behaviour), check current docs (Context7 MCP if connected, otherwise web) and cite them in the record. Never decide on a remembered API.

## 5. Spikes

If you can't decide without trying something, don't guess — say so in your report as a **spike request** (question, what you'd test, how long). The orchestrator schedules it as its own step before your contract.

---
Sources (ideas adapted, text written for Baseleap): affaan-m/ECC `architecture-decision-records` (MIT — Nygard format, numbered index, alternatives with "why not"), Jeffallan/claude-skills (MIT). borghei/Claude-Skills `senior-architect` and skillrecordings/adr-skill reviewed for ideas only (Commons Clause / no licence — not installed, no text reused).
