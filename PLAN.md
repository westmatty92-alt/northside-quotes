# Plan: Northside quote requests: full-team rehearsal
Profile: full_stack (plus integration and docs, all 11 roles). Server rules (spam limits, photo checks, NQ- references), staff auth, private photos and a server-held GHL token with retries need a backend; this is the full-team rehearsal.
Build mode: hybrid. System of record: app · platforms: app (form, inbox list + board, all pipelines, source of truth; Supabase ca-central-1) · ghl (test sub-account: website hosting + email marketing only; one-way contact copy tagged quote-request + current stage tag)

Done means: QA's Playwright E2E passes on the staging preview for submit with photos → NQ- reference → owner sees it first in the inbox → price + note → won (list or board) → weekly count updates; after Gate 3 the production health URL returns 200.

Client: Northside Plumbing (TEST), 5998ee79-50f0-4552-b64f-5addcd6277cb · Gate 1 approved 2026-11-19 22:48 UTC (2nd ask: 13A 14A, extras accepted; board-adoption metric struck afterwards).

## Submissions
1. **Blueprint plan** (this one): D1, OPS-SETUP, A1, S0, DOC0, A2.
2. **Build plan**: after A1/A2/S0 verify, before contract_lock. Backend, frontend, integration, devops, QA, reviewer, security, designer visual review, DOC1, deploy (pipeline drills).

## Waves (blueprint)
| Wave | Steps | Starts when |
|---|---|---|
| 1 | D1, OPS-SETUP | scope_approval (done) |
| 2 | A1 | D1 verified |
| 3 | S0, DOC0, A2 | A1 verified (A2 also waits for Matthew's account_setup approval) |
| then | build plan submitted → **Gate 2 · contract_lock** (blueprint + screenshots + build plan) | S0 findings answered |

## Graph
P0 ─┬ D1 ── A1 ─┬ S0 ───────────────┐
    │           ├ DOC0 ─────────────┤── Gate 2
    │           └ A2 ···(account_setup)┘
    └ OPS-SETUP ──► account_setup gate

## Steps
### D1 · designer · design: brand contract, user flows, design specs, rendered mockups
Depends on: P0 · Verify: `npx --yes @google/design.md lint DESIGN.md` · `node scripts/check-design.mjs`. Screenshots go in the Gate 2 packet (Matthew's request).
### OPS-SETUP · devops · design: account-setup packet
Depends on: P0 · Verify: `test -s docs/ops/account-setup.md` · no `{{`. Opens the account_setup gate when verified.
### A1 · architect · design: blueprint + integration contract
Depends on: D1, OPS-SETUP · Verify: `node scripts/check-architecture.mjs` · `npx --yes @redocly/cli lint docs/openapi.yaml` · `node scripts/check-mock.mjs` · OQ-11/OQ-15 grep. Answers OQ-11 / OQ-15 (GHL fields, tag add/remove).
### S0 · security · design: threat model
Depends on: A1 · Verify: `test -s docs/threat-model.md` · `test -s .baseleap/reviews/S0.md`
### DOC0 · docs · design: SOP plan
Depends on: A1 · Verify: `test -s docs/sops/plan.md` · no `{{`
### A2 · architect · design: scaffold, migrations + RLS tests on staging, mock
Depends on: A1, OPS-SETUP · requires account_setup · Verify: `npm ci` · `npm run gen:types` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run db:test` · `node scripts/check-mock.mjs` · code guards (generated, service-role)

## Build plan (submitted 2026-11-20, accepted)
| Wave | Steps | Lane |
|---|---|---|
| 1 | OPS1 (devops config/CI/release), BE1 (platform + submission), INT1 (GHL core), FE1 (public pages) | main · wt-backend · main · wt-frontend |
| 2 | BE2 (staff auth), FE2 (staff shell + Requests + detail) | wt-backend · wt-frontend |
| 3 | BE3 (inbox reads/writes), FE3 (Pipeline board) | wt-backend · wt-frontend |
| 4 | INT2 (GHL routes, after lane/backend merges) | main |
| 5 | QA1 (test plan + E2E on staging preview) | — |
| 6 | QA2 (probes + fuzz), DV1 (visual review) | — |
| 7 | REV1, SEC1, DOC1 | — |
| 8 | DEP1 (pipeline drills: release, rollback, secret rotation → prod health 200) | after Gate 3 |

Rulings in the build plan: lane verify-ui runs on a local `next start` with mocks (the ledger can't reach lane previews); real-preview proof comes from QA1/DV1 on staging. Backend/integration staging tests fail, never skip, without env. INT split in two because its routes need backend code.

## Gates
scope_approval (approved) → account_setup (after OPS-SETUP verifies; holds A2) → contract_lock (blueprint + screenshots + build plan) → release_approval. spend_approval: none expected; a second Supabase project or Vercel preview protection would need one if paid.

## Risks
- A2's db:test is the first real run of A1's migrations; A2 owns those paths in its later wave and fixes defects there.
- S0 runs beside A2: a Critical/Important finding reopens A1, then A2 (re-run gen:types and db:test) before Gate 2.
- Verify for A2 needs SUPABASE_STAGING_DB_URL only in this machine's env. No Supabase access token on agent machines (Matthew's Nov 18 rule); no `supabase db push` (deny list). Production (Matthew, token A): no Supabase personal access token anywhere; release migrations use the production database connection string, stored only in the GitHub `production` environment. Goes into the devops pipeline/release step descriptions in the build plan.
- The board is the biggest Must; the build plan may split it.

## Notes
- Integration step (bl-integration) planned for the build plan: runtime data moves to GHL (contact copy + stage-tag swaps with retries), more than one outbound call. Confirmed against the integration contract at build-plan time.
- Kit note: `build-specs/build-modes.md` isn't present in this repo; the hybrid pipeline rule comes from Matthew's Gate 1 ruling (ledger decision).
