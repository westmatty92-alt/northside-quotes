# Security Model: <Product>

**Status:** proposed (locked at Gate 2) · **Reviewed against by:** bl-security (Phase 4)

## System and scope
<What this covers: the Next.js app, its API routes, the Supabase project, embed routes. What it doesn't: GHL itself, Stripe itself.>

## Trust boundaries
| Boundary | Untrusted side | Control |
|---|---|---|
| Browser → `/api/*` | request body, query, headers | session check + zod validation from the contract |
| Browser → Supabase (direct) | everything | RLS policies (listed tables only) |
| Stripe / GHL → `/api/webhooks/*` | payload | signature verification, idempotency on event id |
| AI feature → model | any text the model reads | treated as data, never instructions |

## Permission matrix
| Resource | <Role A> | <Role B> | <Role C> |
|---|---|---|---|
| <table / route> | <…> | <…> | <…> |

## Security invariants (each must hold; each is checkable)
1. RLS is enabled with at least one policy on every table in `public`.
2. `SUPABASE_SERVICE_ROLE_KEY` is read only in: `<src/lib/server/admin.ts>`. It never appears in client bundles, logs or fixtures.
3. Every route under `src/app/api/` except `<health, webhooks>` rejects requests without a valid session.
4. Webhook routes verify signatures before reading the payload.
5. Embed routes set `frame-ancestors` to `<client GHL domains>` only.
6. No personal data in analytics event properties or logs (except as specified in `docs/metrics-spec.md`).
7. <product-specific invariant, e.g. "a booking can only be created for an open slot — enforced by unique constraint, not just UI">

## Finding classes (what counts as a problem here)
- **Critical:** cross-tenant data access, auth bypass, secret exposure, unsigned webhook trust, money manipulation
- **Important:** missing rate limit on a costly endpoint, overly broad CORS/frame-ancestors, personal data in logs
- **Minor:** missing security headers on non-sensitive pages, verbose error details

## Out of scope / accepted risk
- <e.g. GHL account compromise; accepted because …>

## Known limitations & compensating controls
- <e.g. third-party cookies blocked in Safari for embeds → token-in-memory fallback>
