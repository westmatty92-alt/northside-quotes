# Test Plan: <project>

**PRD version:** <git sha or date> · **Contract locked:** <date> · **Last updated:** <date>, by bl-qa (step <id>)
**Target:** the `staging` Vercel preview (integrated build) · never production

## Acceptance criteria → tests

| AC | Story | Risk | Level | Test | Tag | Data |
|---|---|---|---|---|---|---|
| AC-001.1 | <US-001 Sign in> | H | e2e | `tests/e2e/auth.spec.ts › AC-001.1 signs in with email link` | @smoke | customer@tenantA |
| AC-003.1 | <US-003 Book a slot> | H | e2e | `tests/e2e/booking.spec.ts › AC-003.1 books an open slot` | @smoke | customer@tenantA, open slot |
| AC-003.2 | <US-003> | H | e2e | `tests/e2e/booking.spec.ts › AC-003.2 slot taken shows next 3 slots` | @regression | taken slot |
| AC-004.3 | <US-004 Cancel> | M | api | `tests/e2e/api/bookings.spec.ts › AC-004.3 cancel inside 24h → 409` | @regression | booking < 24h away |

## Boundaries

| Input (operation · field) | Rule from PRD/contract | Cases |
|---|---|---|
| createBooking · `notes` | ≤ 500 chars | 0, 1, 500, 501, emoji, `<script>` |

## Permission rows (from SECURITY_MODEL.md)

| Operation | customer (own) | customer (other tenant) | staff | anonymous |
|---|---|---|---|---|
| listBookings | 200 own only | 200, none of A's | 200 tenant | 401 |
| cancelBooking | 204 | 404 | 204 | 401 |

Test: `tests/e2e/api/permissions.spec.ts`

## NFR checks

| NFR | Check | Test |
|---|---|---|
| Accessibility | axe: 0 violations on every screen | `tests/e2e/a11y.spec.ts` |
| Embed | renders and works in a 400 px GHL iframe | `tests/e2e/embed.spec.ts` |
| Performance | LCP ≤ 2.5 s on <screen> (mobile profile) | `tests/e2e/perf.spec.ts` |
| Analytics | `booking_created` fires once with the spec'd properties | `tests/e2e/booking.spec.ts` |

## Fuzz run

`tests/fuzz/run.sh` · operations included: <all except webhooks> · roles: customer, staff · budget: 10 min

## Not tested, and why

| Item | Why |
|---|---|
| <none> | |
