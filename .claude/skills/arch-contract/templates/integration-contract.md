# Integration Contract: <Product>

**Status:** proposed (locked at Gate 2) · **Build mode:** <platform_extension | hybrid> · **Implemented by:** bl-integration (or bl-backend when only one outbound call) · **Platform docs:** <links, or "uploaded action/trigger docs for Monday/HubSpot">

## Systems and roles
| System | Role | Owner of the setup |
|---|---|---|
| <Our app (Supabase)> | <system of record for orders, customers> | dev team |
| <GHL sub-account "Client X"> | <website forms, email/SMS marketing> | CRM Automation |

## Record ownership
One system of record per record type. The other side holds a copy and never wins a conflict.
| Record | System of record | Copy kept in | Link key |
|---|---|---|---|
| <Contact> | <our app> | <GHL contact> | <`contacts.ghl_contact_id` ↔ GHL `id`> |

## Field mapping
Direction: `in` (platform → our app) · `out` (our app → platform) · `both` (only with a conflict rule below) · `read-only` (we read on demand, never store).
| Record | Our field | Platform field | Direction | Transform / notes |
|---|---|---|---|---|
| <Contact> | <`email`> | <`email`> | <in> | <lowercased; required> |
| <Contact> | <`tags`> | <`tags`> | <out> | <only `customer`, `vip`; never remove tags we didn't add> |

## Events and webhooks
| Trigger | Direction | Endpoint / call | Idempotency key | Signature check |
|---|---|---|---|---|
| <GHL form submitted> | <in> | <`POST /api/webhooks/ghl`> | <GHL event id> | <shared secret header> |
| <Order paid> | <out> | <GHL `POST /contacts/{id}/tags`> | <`order_id`> | n/a |

## Sync jobs
| Job | Schedule | Cursor | Batch size | What it reconciles |
|---|---|---|---|---|
| <none / `sync-ghl-contacts`> | <every 15 min> | <`updated_at` per tenant> | <100> | <tags drift> |

## Conflicts
<The rule for every `both` field: the system of record wins, or last-write-wins by timestamp with the losing value logged. No silent merges.>

## When the platform is down
| Situation | What users see | What the system does |
|---|---|---|
| <GHL API times out or 5xx> | <nothing — orders still save> | <outbound work queued, retried with backoff for 24 h, then dead-lettered and flagged> |
| <Token revoked / 401> | <owner sees "Reconnect GHL" banner> | <sync paused for that tenant; no crash loop> |
| <Webhook missed> | <nothing> | <the sync job reconciles within one schedule> |

## Credentials and scopes
| System | Auth | Scopes | Stored as |
|---|---|---|---|
| <GHL> | <Private Integration Token / OAuth> | <contacts.readonly, contacts.write> | <Supabase Vault per tenant; env var name only> |

## Setup the platform side must do (handoff to CRM Automation)
- <Custom field `baseleap_order_id` on contacts>
- <Workflow "Order paid → thank-you SMS" triggered by tag `customer`>
