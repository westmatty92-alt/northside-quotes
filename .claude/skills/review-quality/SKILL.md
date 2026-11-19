---
name: review-quality
description: Code-quality review for bl-reviewer — check the staging diff against the PRD acceptance criteria, the API contract and the architect's boundaries, then for minimal diffs, dead or duplicated code, strict typing, error handling and test honesty. Use on every code-review step together with review-performance and review-verdict.
---

# Review · Correctness, Contract & Maintainability

The question isn't "would I have written it this way?" It's "does this do what was promised, inside the rules, without leaving a trap for the next change?"

## 1. Does it do what was promised?

For every AC the diff serves: find the code path that satisfies it and the test that proves it. Mark **met** (cite the line and the test), **not met** (Critical), or **can't tell** (say what's missing — usually a test).
- Business rules match the PRD exactly (money in integer cents, time zones, limits, edge cases in `[edge]`/`[error]` criteria).
- Nothing the PRD marks out of scope was built (scope creep is Important: it's untested, unowned surface).
- **Search the ACs for every behaviour the diff changes, even when no story is "mapped" to it.** For each changed query order, filter, count, limit, message, validation or permission, `grep -n` `docs/user-stories.md` for that behaviour (e.g. "listed first", "in that order", "shows the message"). An AC whose behaviour the diff changes or removes is **not met → Critical**, never a Minor about style. (Drill, Nov 18 2026: a removed `created_at` tie-break broke AC-004.6 and was filed as a Minor with "no AC could be assessed".)
- **Hand edits to generated code** (`src/lib/api/generated/**`, `src/types/database.ts`, `src/app/theme.css`) are their own Important finding ("generated file edited; change the contract and regenerate"), whatever else they cause.

## 2. Does it keep the contract and the architecture?

- Every handler matches `docs/openapi.yaml`: paths, shapes, status codes, problem+json errors. No undocumented fields, endpoints or codes.
- **Generated code untouched:** `src/lib/api/generated/**`, `src/types/database.ts`, `src/app/theme.css` match a fresh generation; no hand edits.
- **Boundaries:** handlers stay thin and call services; services don't import UI; client components don't import `src/lib/server/**`; the frontend reaches the API only through generated hooks; tokens only from `DESIGN.md`.
- Migrations, the contract and decisions changed only through the architect (check the diff's file list against lane ownership).

## 3. Is the change minimal and clean?

- **Diff hygiene:** only what the steps needed. Unrelated reformatting, drive-by refactors and speculative abstractions are findings (Minor, or Important if they touch risky code).
- **Dead and duplicated code:** unused exports, unreachable branches, commented-out code, two implementations of the same rule (Important when the duplicates can drift on a business rule).
- **Types:** `strict` holds; no `any`, no `as` casts that hide a mismatch, no `@ts-ignore`/`@ts-expect-error` without a reason; nullable values handled.
- **Errors:** no swallowed errors (`catch {}`), no generic 500s where the contract defines a code, no user-facing stack traces.
- **Readability:** names say what things are; non-obvious rules have a one-line comment with the AC id.

## 4. Are the tests honest?

- Tests assert outcomes, not implementation details; no assertions removed or loosened in the diff to make something pass (Critical — a weakened test hides a defect).
- No `skip`/`only`/`fixme` left in; mocks don't mock the thing under test.
- Each AC the diff serves has a test (from the builder or QA's plan).

## 5. Run, don't assume

`npm run typecheck`, `npm run lint`, `npm run build`, and a regeneration diff for generated code (`orval` / `supabase gen types` / the DESIGN.md export, then `git diff --exit-code` on the generated paths). Results go in the audit table.

---
## 6. Tools: boundaries and dead code (only what the change added)
Install once per project into `.baseleap/tools` (git-ignored, pinned; dependency-cruiser needs a TypeScript below 7 next to it, so pin the project's TS 6 there):
`npm i --prefix .baseleap/tools --no-audit --no-fund dependency-cruiser@18.7.2 knip@6.45.1 typescript@<project's 6.x>`
- **Boundaries:** `.baseleap/tools/node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src` (config from `templates/dependency-cruiser.cjs`: no circular imports, UI never imports server code, server never imports UI, shared code imports no lane, routes stay thin). An `error` is Important (an architecture violation); a `warn` is Minor unless it hides a real bug.
- **Dead code:** `.baseleap/tools/node_modules/.bin/knip --no-progress --reporter json` (config from `templates/knip.json`).
- **Report only what the change added.** Run both on the base commit and on the head, and compare. Existing dead code or violations in untouched files are not this change's findings (list them once under "pre-existing" for the architect, never as blockers). Tested Nov 15 on a scaffold: a clean base had 34 unused exports already; reporting them all would bury the real finding.
- **Formatting is the linter's job.** Never comment on formatting, indentation or import order; if the linter passes, it's settled.

## 7. Cross-lane duplicates (combined staging diff)
Frontend, backend and integration build in parallel lanes, so the same helper often gets written twice. On the combined staging diff, look specifically for duplicated **types, constants, schemas and helpers** across lanes (two date formatters, two copies of a status enum, a Zod schema redefined instead of imported from the generated contract). Each duplicate is a finding routed to the architect to move into `src/lib/shared/` (the architect owns it), or to the lane that should import the existing one. Report them under "Cross-lane consolidation" in the verdict — **never under Minor or as "dead code"**, even when nothing imports them yet: the second copy is how drift starts.

Sources (ideas adapted, text written for Baseleap): sverweij/dependency-cruiser (MIT, tool), webpro-nl/knip (ISC, tool), multica-ai/andrej-karpathy-skills and obra/superpowers (minimal-diff and verification discipline, ideas only), VoltAgent `code-reviewer.md` (MIT — review checklist), obra/superpowers `requesting-code-review` (MIT — review against the plan/spec, minimal diffs), multica-ai/andrej-karpathy-skills (no licence file — ideas only: surgical changes, no speculative abstraction), qodo-ai/pr-agent (MIT — reviewed for ideas: duplicated/dead code, ranking findings).
