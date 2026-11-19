# Metrics Spec: <Product name>

## Primary metric
| Metric | Definition | Baseline | Target | Window | Owner |
|---|---|---|---|---|---|
| <name> | <how it's computed from the events below> | <value + source, or "unknown — measure 14 days first"> | <value> | <e.g. 30 days after launch> | <who reviews it> |

## Guardrails
| Metric | Definition | Threshold | Window |
|---|---|---|---|
| <name> | <…> | <must stay below / above …> | <…> |

## Leading indicators
| Metric | Definition | Read when |
|---|---|---|
| <name> | <…> | <week 1> |

## Event inventory
| Event | Fires when (exactly) | Properties (name: type) | PII | Feeds metric |
|---|---|---|---|---|
| `object_action` | <precise trigger — server-side save vs client click> | `id: uuid`, `source: enum(web,ghl_embed)` | none | <metric name> |

## Destinations
- <metric/event group> → <GA4 / Meta Pixel / GHL / Supabase `events` table> (one source of truth per metric)

## Privacy & retention
- Default: ids only, no names/emails/phones/free text in event properties.
- <Any exception: what, why, how it's protected, retention>
- <If model input/output is logged: what's captured, what's redacted before leaving the server, who can read it, retention>

## QA tracking checklist
- [ ] `<event>` — perform <action>; confirm it fires once with <properties>
