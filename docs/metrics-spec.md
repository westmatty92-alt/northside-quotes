# Metrics Spec: Northside quote requests

## Primary metric
| Metric | Definition | Baseline | Target | Window | Owner |
|---|---|---|---|---|---|
| Median hours to first quote | For requests submitted in the window, the median of `minutes_since_submit` on each request's first `quote_request_quoted` event, divided by 60. Requests with no such event are excluded from the median and reported next to it as "still unquoted: N". | unknown — measure for 14 days first (the research record is empty and today's requests arrive by phone, text and Facebook, where nobody counts them) | 24 hours or less (decided as OQ-9A; confirmed after the 14-day baseline) | 30 days after launch | Matthew (review at day 30) |

Rehearsal note: the client is fake and has no real traffic, so in the rehearsal this metric is only proven to be computable: the E2E produces one `quote_request_submitted` and one `quote_request_quoted` for the same request, and the value is a number of minutes.

## Guardrails
| Metric | Definition | Threshold | Window |
|---|---|---|---|
| GHL copy success rate | Share of `quote_request_submitted` requests that have a `ghl_sync_succeeded` event within 24 hours of submission | at or above 95% (proposed) | rolling 30 days |
| Photo upload failure rate | `photo_upload_failed` events per 100 `quote_request_submitted` events | at or below 5 per 100 (proposed) | rolling 30 days |
| Blocked submission share | `spam_submission_blocked` events divided by (`spam_submission_blocked` plus `quote_request_submitted`) | at or below 20% (proposed; a higher share suggests real people are being blocked, or a bot wave) | rolling 30 days |

## Leading indicators
| Metric | Definition | Read when |
|---|---|---|
| Requests submitted per week | Count of `quote_request_submitted` per Monday-to-Sunday Hamilton week | week 1 |
| Share of requests with photos | `quote_request_submitted` events with `photo_count` above 0, divided by all of them | week 1 |

## Event inventory
| Event | Fires when (exactly) | Properties (name: type) | PII | Feeds metric |
|---|---|---|---|---|
| `quote_request_submitted` | the server has stored the request and all of its photos (not when the Send button is tapped, and not for refused or failed submissions) | `request_id: uuid`, `urgency: enum(emergency,soon,flexible)`, `photo_count: int` | none | Median hours to first quote; GHL copy success rate; Photo upload failure rate; Blocked submission share; Requests submitted per week; Share of requests with photos |
| `quote_request_quoted` | the server saves a price on a request that had no price before (first time only; later price changes do not fire it) | `request_id: uuid`, `minutes_since_submit: int` | none | Median hours to first quote |
| `quote_request_status_changed` | the server stores a real status change, from the list or from a board drop or "Move to" menu (selecting the current status, or dropping a card back in its own column, does not fire it; a refused or failed save does not fire it) | `request_id: uuid`, `from_status: enum(new,quoted,won,lost)`, `to_status: enum(new,quoted,won,lost)`, `user_id: uuid` | none (internal user id only) | none (audit only, the weekly count is read from stored status change times) |
| `photo_upload_failed` | the server refuses or fails to store a photo during a submission attempt (wrong type, over 5 MB, storage error) | `reason: enum(too_large,bad_type,storage_error)`, `photo_index: int` | none | Photo upload failure rate |
| `spam_submission_blocked` | the server refuses a submission because of the honeypot, the 3-second minimum or the rate limit | `reason: enum(honeypot,too_fast,rate_limited)` | none (the network address is used for the rate limit but is never written to the event) | Blocked submission share |
| `ghl_sync_succeeded` | GoHighLevel confirms the contact was created for a request (first or retried attempt) | `request_id: uuid`, `attempt_number: int` | none | GHL copy success rate |
| `ghl_sync_attempt_failed` | one copy attempt to GoHighLevel fails (timeout, error response, missing or rejected token) | `request_id: uuid`, `attempt_number: int`, `error_class: enum(timeout,auth,rate_limited,server_error,config_missing)` | none | none (diagnostic only) |
| `ghl_sync_gave_up` | a request reaches 5 retries after the first attempt without success and automatic retries stop | `request_id: uuid` | none | none (diagnostic only) |
| `ghl_tag_sync_succeeded` | GoHighLevel confirms a request's contact now carries the stage tag for the target status (first or retried attempt) | `request_id: uuid`, `to_status: enum(new,quoted,won,lost)`, `attempt_number: int` | none | none (diagnostic only) |
| `ghl_tag_sync_attempt_failed` | one stage-tag attempt to GoHighLevel fails (timeout, error response, missing or rejected token) | `request_id: uuid`, `to_status: enum(new,quoted,won,lost)`, `attempt_number: int`, `error_class: enum(timeout,auth,rate_limited,server_error,config_missing)` | none | none (diagnostic only) |
| `ghl_tag_sync_gave_up` | a stage-tag push reaches 5 retries after its first attempt without success and automatic retries for it stop | `request_id: uuid`, `to_status: enum(new,quoted,won,lost)` | none | none (diagnostic only) |
| `staff_signed_in` | the server accepts a sign-in by the owner or the helper | `user_id: uuid` | none (internal user id only) | none (audit only) |

## Destinations
- All events above → a Supabase `events` table in the same ca-central-1 project, written by the server (single source of truth for every metric in this file). Readable only by the two signed-in users and Baseleap operators.
- The weekly count shown in the inbox is computed from stored requests and status change times, not from events.
- No GA4, no Meta Pixel, and no event is sent to GoHighLevel (Non-goal NG-11). The stage tags on the GoHighLevel contact (FR-24) are part of the product, not analytics events.

## Privacy & retention
- Default: ids only. No names, emails, phones, addresses, problem text, notes, prices or photo content in event properties.
- Exceptions: none. `user_id` is the internal id of the owner or helper, not an email.
- The network address is read by the rate limiter only and is never stored in an event. Whether the rate limiter keeps it, and for how long, is the architect's call and must be written in `docs/SECURITY_MODEL.md`.
- Failed-copy records hold request id, attempt number and error class only: no token, no personal data (AC-010.5). Failed stage-tag records also hold the target status and nothing else (AC-017.13).
- No model input or output is logged (no AI features).
- Retention of events: for a real client, same period as the requests (OQ-10); in the rehearsal all data is test data.

## QA tracking checklist
- [ ] `quote_request_submitted` — submit a valid request with 3 photos; confirm exactly 1 event with `request_id` matching the stored request, `urgency` as chosen and `photo_count` 3; then double-tap Send on another request and confirm still exactly 1 event; then submit with a refused field and confirm 0 events.
- [ ] `quote_request_quoted` — save a price on a request with no price; confirm 1 event with `minutes_since_submit` at least 0; save a different price on the same request and confirm no second event.
- [ ] `quote_request_status_changed` — mark a New request Won from the list; confirm 1 event with `from_status` new, `to_status` won and the signed-in `user_id`; select Won again and confirm no new event. Then drag another New card to Quoted on the board and confirm 1 event with `from_status` new and `to_status` quoted; drop a card back into its own column and confirm 0 events; force a failed save on a drop and confirm 0 events. Drag a card with no price to Quoted and confirm 0 `quote_request_quoted` events.
- [ ] `ghl_tag_sync_succeeded` — with GoHighLevel reachable, move a copied request to Won; confirm 1 event with `to_status` won and `attempt_number` 1, and that the contact carries `quote-request` and `quote-won` only.
- [ ] `ghl_tag_sync_attempt_failed` — with GoHighLevel stubbed to fail, change a status; confirm the status is saved, and 1 event with `attempt_number` 1, the target `to_status` and the matching `error_class`.
- [ ] `ghl_tag_sync_gave_up` — with GoHighLevel failing through 5 retries of a stage-tag push, confirm 1 event and that the request shows "Stage tag failed".
- [ ] `photo_upload_failed` — try a PDF, then a 5,242,881-byte file; confirm one event each with `reason` bad_type and too_large; confirm the stored request count did not change.
- [ ] `spam_submission_blocked` — fill the hidden field and submit (honeypot); submit within 3 seconds (too_fast); send a 6th valid submission in 10 minutes (rate_limited); confirm 1 event each with the right `reason` and 0 requests stored.
- [ ] `ghl_sync_succeeded` — with GoHighLevel reachable, submit a request; confirm 1 event with `attempt_number` 1 and 1 contact tagged `quote-request` in the test sub-account.
- [ ] `ghl_sync_attempt_failed` — with GoHighLevel stubbed to fail, submit a request; confirm the request is stored and 1 event with `attempt_number` 1 and the matching `error_class`.
- [ ] `ghl_sync_gave_up` — with GoHighLevel failing through 5 retries, confirm 1 event and that the request shows "Copy to GoHighLevel failed".
- [ ] `staff_signed_in` — sign in as the owner and as the helper; confirm 1 event each with the matching `user_id`; fail a sign-in and confirm 0 events.
- [ ] Privacy — read 20 rows of the `events` table after the E2E and confirm no name, email, phone, address, problem text, note, price or token appears in any property.
