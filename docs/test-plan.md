# Test Plan: Northside quote requests

**PRD version:** v1.2.1 (2026-11-20) · **Contract locked:** Gate 2 (`docs/openapi.yaml`, `docs/SECURITY_MODEL.md`, `docs/architecture.md`) · **Last updated:** 2026-11-23, by bl-qa (step QA1)
**Target:** the `staging` Vercel preview, `https://northside-quotes-git-staging-baseleap.vercel.app` (commit `6ae29eb`, the expected host; the health route reports that commit) · never production, never a local server
**Status of this plan:** every AC below has a row. Specs for the rows marked **E2E** are written (`tests/e2e/**`, 124 tests). On the QA1 run **no staff or public-form spec could run**: sign-in and the form-token routes answer 503/500 on the preview (ticket BUG-QA1-1 in `.baseleap/reports/QA1-errors.md`). The specs were written from the PRD, stories, design copy and contract, and have not yet met the running app beyond the sign-in page: expect `test`-class locator fixes on the first working run (reported as such, never hidden).

## How the suite runs

| Item | Rule |
|---|---|
| Command | `node --env-file=.env.local node_modules/.bin/playwright test tests/e2e --grep-invert @probe` (the ledger form; it was refused in the QA1 session, `npx playwright test tests/e2e --grep-invert @probe` was used and gives the same run) |
| Base URL | `STAGING_URL` from `.env.local` (loaded by `playwright.config.ts` itself). The config throws unless it is an `https` `<project>-git-staging-<team>.vercel.app` host and not a production host |
| Vercel protection | `x-vercel-protection-bypass` plus `x-vercel-set-bypass-cookie: true` on the first navigation of each browser context, only for the preview host (a context route). API calls send only the bypass header (the cookie header makes Vercel answer 307). Nothing is sent to `*.supabase.co`, so the direct photo upload keeps working |
| Projects (run in this order, 1 worker) | `setup` (signs in owner and helper, saves sessions to `playwright/.cache/auth/`, git-ignored) · `preview` (platform checks, no session needed) · `phone` (390 x 844, touch: the done spine and the accepted submissions) · `phone-staff` (phone: form refusals, staff tabs, detail, board) · `desktop` (1280 x 800: sign-in, the same staff specs, the board drag tests) · `phone-late` (the last 3 accepted submissions) |
| Every test, automatically | fails on console errors and on 4xx/5xx the test did not declare; attaches every `x-vercel-id`; traces, screenshots and video kept on failure; axe at WCAG 2.1 A/AA (fails on serious or critical, as the PRD says; lesser findings are attached and annotated) |
| Retries | 1, for detection only: fail-then-pass is reported FLAKY, never as a pass. Tests that make the server accept a request set retries to 0 (a retry would spend more of the submission budget) |
| Submission budget | The public form accepts 5 accepted submissions per 10 minutes per network address (FR-8). All tests share one address, so each accepting test first takes a slot from a ledger and, when 5 are in the last 10 minutes, waits for the oldest to age out (its timeout is extended by exactly that wait). The suite makes 8 accepted requests (spine 1, A 1, B 2, C 1, late 3); the project order puts the last 3 after the window has passed. The wait honours the limit; it is not a retry sleep |
| Test data | Staging is shared. Every request the suite creates has a name starting `QA-E2E <run id>`; requests cannot be deleted through the API, so they are listed in `docs/qa-reports/qa-e2e-created.ndjson` (written during the run) and in the run report. Status, price and note of those requests are put back or changed through the owner API |
| Human speed | The form refuses a send in the first 3 seconds (FR-8). The suite waits until 3.5 s after the page was requested before pressing Send, as a person would |

## Acceptance criteria → tests

Columns: **Cover** is `E2E` (browser flow), `API` (black-box request to the deployed API), `QA2` (permission or abuse probe, tagged `@probe`, written in QA2, not in this run), `INT` (live GoHighLevel behaviour: covered offline by the INT1/INT2 simulator tests in `tests/integrations/`; **live GHL is unverified** because `GHL_LOCATION_ID` and the token are unset on staging), `DB` (a calculation or database rule covered by the backend/architect SQL tests in `supabase/tests/`, not observable black-box), `INSPECT` (by reading configuration), `NOT TESTED` (reason in "Not tested, and why").
File keys: `spine` = `spine.phone.spec.ts`, `subs` = `submissions.phone.spec.ts`, `late` = `late.phone.spec.ts`, `form` = `form.phone.spec.ts`, `auth` = `auth.desktop.spec.ts`, `req` = `requests.both.spec.ts`, `detail` = `detail.both.spec.ts`, `board` = `pipeline.desktop.spec.ts`, `board-phone` = `pipeline.phone.spec.ts`, `screens` = `screens.both.spec.ts`, `platform` = `platform.both.spec.ts`. A test is cited by the AC ids in its title.

| AC | Story | Risk | Cover | Test | Tag | Data |
|---|---|---|---|---|---|---|
| AC-001.1 | US-001 | H | E2E | `spine › the homeowner submits with 3 photos and the owner prices it…` (steps 1 and 2) | @smoke | anonymous phone, 3 JPEGs of 2 MB, box untouched |
| AC-001.2 | US-001 | H | E2E | `form › AC-001.2 empty required fields…` | @regression | none |
| AC-001.3 | US-001 | H | E2E | `form › AC-001.3` (9 and 2,001 refused) + `subs › AC-001.14 AC-001.3 …` (10 accepted) | @regression | 10-char problem |
| AC-001.4 | US-001 | M | E2E | `form › AC-001.4` | @regression | phone "12345", email "dana@" |
| AC-001.5 | US-001 | H | E2E | `subs › AC-001.14 AC-001.3 AC-001.5 …` (name `Zoë O'Brien <script>alert(1)</script>`, no dialog, no `<script>` in main) | @regression | tagged name |
| AC-001.6 | US-001 | H | E2E | `subs › AC-001.6 AC-002.3 AC-002.7` (double click, one request by name via API) | @regression | tagged name |
| AC-001.7 | US-001 | M | E2E | `subs › AC-001.7 S0 Back and resend` (same phone, two requests, two references) | @regression | same phone twice |
| AC-001.8 | US-001 | H | E2E (partial) | `form › AC-001.8` (503 answered at the network edge: message, entries and photo kept, no reference). "Nothing partial in the inbox once the database is back" is a server rule: backend `tests/api` | @regression | none |
| AC-001.9 | US-001 | H | E2E (token missing) + INT (GHL down) | `subs › AC-001.14 … AC-001.9` (ticked request confirmed although no GHL token is configured on staging); GHL 5xx/slow: `tests/integrations` | @regression | ticked request |
| AC-001.10 | US-001 | M | E2E | `form › AC-001.10` (simulated 4G, see SQ-2) | @regression | none |
| AC-001.11 | US-001 | H | E2E | `form › AC-001.11` (tab order, honeypot skipped) + `screens › AC-001.11 AC-001.18 Request page: structure and axe` | @regression | none |
| AC-001.12 | US-001 | M | E2E (partial) + INSPECT | `spine` (every host contacted is the preview or Supabase: no mail/SMS/CAPTCHA service reached from the browser). Server-side sending is excluded by the architecture (no provider configured, NG-1) | @smoke | none |
| AC-001.13 | US-001 | M | INSPECT | database region ca-central-1: not observable from the browser; read from the A2/OPS evidence (SQ-1) | n/a | n/a |
| AC-001.14 | US-001 | H | E2E | `subs › AC-001.14 …` (consent true, consent time within 2 s of the stored time, via owner API) | @regression | tick the box |
| AC-001.15 | US-001 | H | E2E | `form › AC-001.15 AC-001.18` (unticked on every load, also after reload) + `spine` (stored as no, no time) + `subs › AC-001.6 …` | @smoke | none |
| AC-001.16 | US-001 | H | E2E | `form › AC-001.16` | @regression | ticked, email empty |
| AC-001.17 | US-001 | H | API | `late › AC-001.17` (missing value, and "maybe": stored no, no time, `not_copied_no_consent`) | @regression | direct POSTs |
| AC-001.18 | US-001 | H | E2E | `form › AC-001.15 AC-001.18` (label text, Space ticks and unticks) + axe in `screens` and `form` | @regression | none |
| AC-002.1 | US-002 | H | E2E | `spine` (3 thumbnails with Remove, 3 photos on the stored request) | @smoke | 3 JPEGs |
| AC-002.2 | US-002 | M | E2E | `form › AC-002.2` | @regression | 4 files |
| AC-002.3 | US-002 | H | E2E | `form › AC-002.3` (5,242,881 refused, 5,242,880 accepted at attach) + `subs › AC-001.6 AC-002.3 AC-002.7` (three 5,242,880-byte photos stored) | @regression | boundary files |
| AC-002.4 | US-002 | H | E2E | `form › AC-002.4` (PDF, and text renamed `leak.jpg`) | @regression | fake files |
| AC-002.5 | US-002 | M | E2E | `subs › AC-001.14 … AC-002.5` ("No photos") | @regression | no photos |
| AC-002.6 | US-002 | H | E2E | `late › AC-002.6` (upload of photo 2 aborted; error beside photo 2; Send again completes one request) | @regression | 3 photos |
| AC-002.7 | US-002 | M | E2E | `subs › AC-001.6 AC-002.3 AC-002.7` (3 x 5 MB on simulated 4G, confirmation within 20 s; SQ-2) | @regression | 15 MB |
| AC-002.8 | US-002 | H | QA2 (@probe) | direct photo address with no sign-in. QA1 covers only the signed side: `detail › AC-002.8 (signed side)` | @regression | stored photo |
| AC-002.9 | US-002 | M | QA2 + INSPECT | bucket private (probe), region (SQ-1) | n/a | n/a |
| AC-003.1 | US-003 | M | E2E | `spine` (accepted after a human-speed fill; only the preview and Supabase are contacted) | @smoke | none |
| AC-003.2 | US-003 | H | QA2 (@probe) | honeypot filled. QA1: `form › AC-003.2 (page side)` checks the field is hidden, out of the tab order, aria-hidden | @regression | none |
| AC-003.3 | US-003 | H | QA2 (@probe) | send under 3 seconds | n/a | n/a |
| AC-003.4 | US-003 | H | QA2 (@probe) | the 6th send in 10 minutes. The QA1 suite itself stays inside the limit (budget above) | n/a | n/a |
| AC-003.5 | US-003 | M | NOT TESTED | the rate-limit counter cannot be made unreadable on staging (backend `supabase/tests`) | n/a | n/a |
| AC-003.6 | US-003 | M | E2E | `spine` (host allow-list: preview and Supabase only; 0 vendor requests) | @smoke | none |
| AC-003.7 | US-003 | M | QA2 (@probe) | 30 honeypot refusals, event count (needs database read) | n/a | n/a |
| AC-003.8 | US-003 | L | QA2 (@probe) / DB | daily event cap of 1,000 | n/a | n/a |
| AC-004.1 | US-004 | H | E2E | `auth › AC-004.1` (@smoke) + `setup` sign-ins | @smoke | owner |
| AC-004.2 | US-004 | H | E2E | `req › AC-004.2` (helper sees the same list, saves price, note, status) | @regression | helper |
| AC-004.3 | US-004 | H | E2E | `auth › AC-004.3` | @regression | owner |
| AC-004.4 | US-004 | H | E2E + API | `auth › AC-004.4 a wrong password and an unknown email show the same message`; `auth › … 401 invalid_credentials` (one wrong password for the owner, one unknown email: never near the lockout) | @regression | owner email, unknown email |
| AC-004.5 | US-004 | H | QA2 (@probe) | 5 failures then lockout (would lock the owner out of QA1) | n/a | n/a |
| AC-004.6 | US-004 | M | E2E (page) + QA2 (direct request) | `auth › AC-004.6 AC-004.10` | @regression | none |
| AC-004.7 | US-004 | H | E2E (simulated) | `detail › AC-004.7` (the save is answered with the contract's 401 `session_expired`; the app signs out and shows sign-in). Real 7-day expiry is not run | @regression | owner |
| AC-004.8 | US-004 | H | QA2 (@probe) | no sign-in, list and one request | n/a | n/a |
| AC-004.9 | US-004 | H | E2E | `auth › AC-004.9` (afterwards the saved owner session is renewed, because sign-out revokes it) | @regression | owner |
| AC-004.10 | US-004 | M | E2E (page) + QA2 (direct requests, no email) | `auth › AC-004.6 AC-004.10` (no forgot, reset, change, sign-up on the sign-in page) | @regression | none |
| AC-004.11 | US-004 | H | QA2 (@probe) | per-address limit | n/a | n/a |
| AC-004.12 | US-004 | H | QA2 (@probe) | unknown email lockout | n/a | n/a |
| AC-004.13 | US-004 | M | QA2 / NOT TESTED | counters unreadable cannot be induced from outside; the 503 message appears for real on the QA1 run (BUG-QA1-1) | n/a | n/a |
| AC-004.14 | US-004 | H | E2E | `auth › AC-004.14` | @regression | owner |
| AC-005.1 | US-005 | M | E2E | `req › AC-005.1` (UI order = API order, row facts, 12-hour time) | @smoke | any |
| AC-005.2 | US-005 | H | E2E | `spine` step 3 (new request first, status New) | @smoke | spine request |
| AC-005.3 | US-005 | H | E2E | `detail › AC-005.3 AC-016.5` + `subs › … ` (tel and mailto links) | @regression | request with 3 photos |
| AC-005.4 | US-005 | L | NOT TESTED | needs an empty inbox | n/a | n/a |
| AC-005.5 | US-005 | M | NOT TESTED | needs 51 requests (SQ-6) | n/a | n/a |
| AC-005.6 | US-005 | M | E2E | `subs › … AC-002.5` ("No photos" on the detail) | @regression | no photos |
| AC-005.7 | US-005 | M | E2E (simulated) | `detail › AC-005.7` (requests for the photo files fail: "Photo unavailable" x3, rest shown) | @regression | 3-photo request |
| AC-005.8 | US-005 | M | E2E | `req › AC-005.8` (list visible within 2 s) | @regression | none |
| AC-005.9 | US-005 | M | E2E | `req › AC-005.9` + `board-phone › AC-005.9` (375 px) | @regression | none |
| AC-005.10 | US-005 | H | E2E | `req › AC-005.10 AC-016.19` | @smoke | none |
| AC-006.1 | US-006 | H | E2E | `spine` step 4 + `detail › AC-006.1 AC-015.1` | @smoke | spine request |
| AC-006.2 | US-006 | M | E2E | `detail › AC-006.2 AC-006.6` | @regression | request |
| AC-006.3 | US-006 | H | E2E | `detail › AC-006.3` (0, 100000.00, 450.555 refused; 0.01 and 99999.99 stored to the cent) | @regression | request |
| AC-006.4 | US-006 | M | E2E | `detail › AC-006.4` (1,001 refused, 1,000 accepted) | @regression | request |
| AC-006.5 | US-006 | H | E2E | `detail › AC-006.5` (owner and helper, stale version: message, nothing overwritten) | @regression | owner + helper |
| AC-006.6 | US-006 | M | E2E | `detail › AC-006.2 AC-006.6` | @regression | request |
| AC-006.7 | US-006 | H | E2E (simulated) | `detail › AC-006.7` (request aborted: message, values kept, nothing stored) | @regression | request |
| AC-007.1 | US-007 | H | E2E | `spine` step 5 (Move to on the list) + `req › AC-007.1` | @smoke | spine request |
| AC-007.2 | US-007 | M | E2E | `req › AC-007.2 AC-007.3 AC-007.5 AC-008.5` | @regression | request |
| AC-007.3 | US-007 | M | E2E | same | @regression | request |
| AC-007.4 | US-007 | M | E2E | `detail › AC-007.4` (no new version, no new change time) | @regression | request |
| AC-007.5 | US-007 | M | E2E | `req › … AC-007.5` (row order unchanged) | @regression | request |
| AC-007.6 | US-007 | H | E2E (simulated) | `req › AC-007.6` | @regression | request |
| AC-007.7 | US-007 | M | NOT TESTED | the audit record (previous, new, time, user) has no read operation (SQ-3); `status_changed_at` and `last_updated` are checked | n/a | n/a |
| AC-008.1 | US-008 | M | E2E (partial) + DB | `req › AC-008.1` (labels, numbers equal the API, week starts Monday, America/Toronto). The 4/1/1 scenario needs controlled data: `supabase/tests` | @regression | any |
| AC-008.2 | US-008 | H | E2E | `spine` (Won +1 within 2 s, list and board) + `board › AC-016.2` | @smoke | spine request |
| AC-008.3 | US-008 | M | DB | week boundary at Sunday 23:59:59 / Monday 00:00:00 (calculation rule) | n/a | n/a |
| AC-008.4 | US-008 | M | DB | submitted last week, won this week | n/a | n/a |
| AC-008.5 | US-008 | M | E2E | `req › … AC-008.5` (Won then Lost: Won -1, Lost +1) | @regression | request |
| AC-008.6 | US-008 | L | DB | daylight-saving week | n/a | n/a |
| AC-008.7 | US-008 | L | NOT TESTED | needs an empty week (SQ-5) | n/a | n/a |
| AC-008.8 | US-008 | M | E2E (simulated) | `req › AC-008.8` | @regression | none |
| AC-009.1 | US-009 | M | INT | contact created within 2 minutes (live GHL unverified) | n/a | n/a |
| AC-009.2 | US-009 | M | INT | GHL 5xx: stored, confirmed, waiting | n/a | n/a |
| AC-009.3 | US-009 | M | INT + E2E (partial) | token missing: `subs › … AC-001.9` shows the ticked request is stored and confirmed with no token configured | @regression | ticked |
| AC-009.4 | US-009 | M | INT | timed-out copy, retry yields one contact | n/a | n/a |
| AC-009.5 | US-009 | L | INT | price or note change leaves the contact alone | n/a | n/a |
| AC-009.6 | US-009 | L | INT | no photo sent | n/a | n/a |
| AC-009.7 | US-009 | M | INT | slow GHL does not delay the confirmation | n/a | n/a |
| AC-009.8 | US-009 | M | INSPECT | only the test sub-account is configured (`docs/integrations/`, INT1 report) | n/a | n/a |
| AC-009.9 | US-009 | H | INT + E2E (partial) | no GHL call is observable from outside; the visible half is `detail › AC-010.6 AC-017.16 AC-014.4` and the API state `not_copied_no_consent` | @regression | unticked |
| AC-009.10 | US-009 | M | INT | second ticked request, same email: one contact | n/a | n/a |
| AC-009.11 | US-009 | M | INT | same phone: one contact | n/a | n/a |
| AC-009.12 | US-009 | M | INT | unticked second request: no call | n/a | n/a |
| AC-009.13 | US-009 | M | INT | ticked second request after unticked first | n/a | n/a |
| AC-010.1 | US-010 | M | INT | "Copied to GoHighLevel" with a time | n/a | n/a |
| AC-010.2 | US-010 | M | INT | automatic retry | n/a | n/a |
| AC-010.3 | US-010 | M | INT | failed after 5 retries | n/a | n/a |
| AC-010.4 | US-010 | M | INT | "Waiting to retry", still editable | n/a | n/a |
| AC-010.5 | US-010 | M | INT | failure record holds no personal data | n/a | n/a |
| AC-010.6 | US-010 | H | E2E | `detail › AC-010.6 AC-017.16 AC-014.4` ("Not copied: no offers consent", no Retry, no stage-tag line) | @regression | unticked request |
| AC-011.1 | US-011 | M | E2E | `req › AC-011.1` | @regression | mixed statuses |
| AC-011.2 | US-011 | L | NOT TESTED | needs zero Lost requests on a shared project (SQ-5) | n/a | n/a |
| AC-011.3 | US-011 | M | E2E | `req › AC-011.3` (row leaves, no reload) | @regression | New request |
| AC-011.4 | US-011 | M | E2E (simulated) | `req › AC-011.4` | @regression | none |
| AC-012.1 | US-012 | M | E2E | `detail › AC-012.1 AC-012.2` (opens, arrows, no wrap) | @regression | 3 photos |
| AC-012.2 | US-012 | M | E2E | `detail › AC-012.1 AC-012.2` (Escape: focus back on the thumbnail, same scroll) + `detail › AC-012.2` (Close button) | @regression | 3 photos |
| AC-012.3 | US-012 | M | NOT TESTED | two real hours; `detail › AC-002.8 (signed side)` shows `GET .../photos` gives fresh working URLs (SQ-4) | n/a | n/a |
| AC-013.1 | US-013 | L | E2E | `req › AC-013.1 AC-013.3 AC-013.2` | @regression | any |
| AC-013.2 | US-013 | L | E2E | same ("No matching requests") | @regression | none |
| AC-013.3 | US-013 | L | E2E | same (partial name) | @regression | any |
| AC-014.1 | US-014 | L | INT | manual Retry works | n/a | n/a |
| AC-014.2 | US-014 | L | INT | Retry fails while GHL is down | n/a | n/a |
| AC-014.3 | US-014 | L | INT | double click, one contact | n/a | n/a |
| AC-014.4 | US-014 | H | E2E + API | `detail › AC-010.6 …` (no Retry) + `detail › AC-014.4 a retry asked for directly…` (409 `not_retryable`, state unchanged) | @regression | unticked request |
| AC-015.1 | US-015 | L | E2E | `detail › AC-006.1 AC-015.1` (Owner) + `req › AC-004.2` (Office helper) | @regression | request |
| AC-015.2 | US-015 | L | E2E | `detail › AC-015.2` | @regression | untouched request |
| AC-016.1 | US-016 | H | E2E | `board › AC-016.1 AC-016.8` (order, cards equal the API per column, facts) + `board-phone › AC-016.1 (phone)` | @smoke | any |
| AC-016.2 | US-016 | H | E2E | `board › AC-016.2 dragging … mouse` (@smoke) + `board › … touch pointer` + `spine` (Move to on the board) | @smoke | New request |
| AC-016.3 | US-016 | H | E2E | `board › AC-016.3` (Enter, arrows, Enter; focus on the card; announcement attached) | @regression | New request |
| AC-016.4 | US-016 | M | E2E | `spine` (list after the board move) | @smoke | spine request |
| AC-016.5 | US-016 | M | E2E | `board › AC-016.5` | @regression | any |
| AC-016.6 | US-016 | M | E2E | `board › AC-016.6` (no new version, no new change time) | @regression | Quoted request |
| AC-016.7 | US-016 | H | E2E | `board › AC-016.7` x2 (Escape mid-drag; release outside the columns) | @regression | New request |
| AC-016.8 | US-016 | M | E2E | `board › AC-016.1 AC-016.8` + `board › AC-016.8` | @regression | any |
| AC-016.9 | US-016 | L | E2E | `board › AC-016.9 AC-016.20` | @regression | none |
| AC-016.10 | US-016 | L | NOT TESTED | needs 51 Quoted requests (SQ-6) | n/a | n/a |
| AC-016.11 | US-016 | L | NOT TESTED | needs a column with no cards on a shared project (SQ-5) | n/a | n/a |
| AC-016.12 | US-016 | H | E2E | `board › AC-016.12` (helper moves first; owner's drag returns; message; helper's change kept) | @regression | owner + helper |
| AC-016.13 | US-016 | H | E2E (simulated) | `board › AC-016.13` x2 (drag and menu; "Saving" then back; count unchanged) | @regression | New request |
| AC-016.14 | US-016 | H | E2E (simulated) | `board › AC-016.14` (401 `session_expired`) | @regression | New request |
| AC-016.15 | US-016 | M | E2E (simulated) | `board › AC-016.15` | @regression | none |
| AC-016.16 | US-016 | M | E2E | `board › AC-016.1 AC-016.8` (axe on the board) + `screens` (card count attached; the AC's 10 cards is a precondition staging should meet) | @regression | board |
| AC-016.17 | US-016 | M | E2E | `board-phone › AC-016.17` (375 px, taps, no sideways scroll) | @smoke | New request |
| AC-016.18 | US-016 | M | E2E | `board › AC-016.18` | @regression | none |
| AC-016.19 | US-016 | H | E2E | `req › AC-005.10 AC-016.19` | @smoke | none |
| AC-016.20 | US-016 | H | E2E | `req › AC-016.20` + `board › AC-016.9 AC-016.20` | @regression | none |
| AC-017.1 | US-017 | M | INT | drag to Quoted updates the stage tag | n/a | n/a |
| AC-017.2 | US-017 | M | INT | Won from the list | n/a | n/a |
| AC-017.3 | US-017 | M | INT | new contact carries `quote-new` | n/a | n/a |
| AC-017.4 | US-017 | M | INT | Won back to New | n/a | n/a |
| AC-017.5 | US-017 | L | INT | same status, no tag call | n/a | n/a |
| AC-017.6 | US-017 | M | INT | quick succession ends on the latest | n/a | n/a |
| AC-017.7 | US-017 | M | INT | status change before the copy exists | n/a | n/a |
| AC-017.8 | US-017 | M | INT | owner's own tag kept | n/a | n/a |
| AC-017.9 | US-017 | M | INT | GHL 5xx: Won saved, "Stage tag waiting to retry" | n/a | n/a |
| AC-017.10 | US-017 | M | INT | token missing: "Stage tag failed", no token on screen | n/a | n/a |
| AC-017.11 | US-017 | M | INT | 5 retries, then failed | n/a | n/a |
| AC-017.12 | US-017 | M | INT | slow GHL: status shows within 3 s | n/a | n/a |
| AC-017.13 | US-017 | M | INT | failure record holds no personal data | n/a | n/a |
| AC-017.14 | US-017 | L | INT | phone edited in GHL is left alone | n/a | n/a |
| AC-017.15 | US-017 | M | INT | two requests, one contact, last change wins | n/a | n/a |
| AC-017.16 | US-017 | H | E2E + INT | `detail › AC-010.6 AC-017.16 AC-014.4` (status saved, no stage-tag line); "GHL receives no call": INT | @regression | unticked request |
| AC-017.17 | US-017 | M | INT | unticked second request leaves the contact's tags alone | n/a | n/a |

**Coverage of the 153 ACs (each AC counted once, by its first cover):** E2E or API spec written: 93 (18 of them cover only the browser-visible half or simulate the failure at the network edge, marked "partial" or "simulated") · QA2 `@probe` only: 12 · INT only (offline simulator, live GHL unverified): 34 · DB (calculation rules in `supabase/tests`): 3 · INSPECT: 2 · NOT TESTED: 9 (each with a reason below). **Passing on the QA1 run: 0 of the 93 written** (blocked by BUG-QA1-1; see `docs/qa-reports/latest-run.md`). The 4 platform checks (not ACs) ran: health and `/inbox` 404 passed; the form-token nonce check and the form-token route check failed on the same ticket.

## Boundaries

| Input (operation · field) | Rule | Cases | Where |
|---|---|---|---|
| createQuoteRequest · `name` | 2 to 100 characters | 1, 2, 100, 101, empty, emoji, `<script>` | QA2 (`@probe`, qa-fuzz); the script-text name is in `subs` |
| `phone` | 10 digits after removing spaces, dashes, brackets, leading +1 | "12345" (QA1), 9, 10, 11 digits, letters, +1 form | `form` (12345); the rest QA2 |
| `email` | valid, up to 254 | "dana@" (QA1), empty, 254, 255 | `form`; the rest QA2 |
| `address` | 5 to 200 | 4, 5, 200, 201 | QA2 |
| `problem` | 10 to 2,000 | 9, 10, 2,000, 2,001 | `form` (9, 2,001), `subs` (10); 2,000 QA2 |
| `urgency` | one of three, none preselected | none chosen, a fourth value | `form`; a fourth value QA2 |
| `marketing_consent` | only JSON `true` is yes | missing, "maybe" (QA1); `"true"`, `1`, `null`, `false` | `late` (missing, "maybe"); the rest QA2 |
| photos | 0 to 3; JPEG, PNG, WebP by content; 5,242,880 bytes | 4th photo, 5,242,881, 5,242,880, PDF, renamed text | `form`, `subs` |
| saveQuote · `price` | 0.01 to 99,999.99, 2 decimals | 0, 0.01, 99999.99, 100000.00, 450.555 | `detail` (all five) |
| saveQuote · `note` | up to 1,000 | 1,000, 1,001 | `detail` |
| Explicit `null` on every optional field of every write | no 500 | one field at a time | QA2 (qa-fuzz) |

## Permission rows (from `docs/SECURITY_MODEL.md`, QA2)

All permission rows are `@probe` tests in `tests/e2e/api/permissions.spec.ts`, written in QA2 and excluded from this run: anonymous 401 on every staff operation; `Bearer undefined`, `Bearer ` and no header 401 on both job routes; direct Supabase REST with the anon key on every table (denied); direct photo address without sign-in (nothing); direct password change, reset, sign-up (refused, no email); sign-in lockouts (per email, per address, unknown email, counters unreadable); form-token abuse (honeypot, too fast, 6th send, replay); stored XSS in every free-text field; open redirect on `?next=`; secrets in the bundles. QA1 only touches the boundary where a business rule is visible in the UI (`detail › AC-014.4` direct retry; `auth` wrong credentials).

## NFR checks

| NFR | Check | Test |
|---|---|---|
| WCAG 2.1 AA, 0 serious or critical (FR-5, AC-016.16) | axe on Request page (empty, errors, filled, with 3 large photos), sign-in, Requests, Pipeline (desktop direct, 375 px), detail, photo viewer, request-sent | `screens`, `form`, `auth`, `spine`, `board`, `board-phone`, `detail` |
| Request page usable in 3 s on simulated 4G | `form › AC-001.10` | measured, asserted |
| 3 x 5 MB confirmed within 20 s on simulated 4G | `subs › AC-001.6 AC-002.3 AC-002.7` | measured, asserted |
| Lists and board visible within 2 s | `req › AC-005.8`, `board › AC-016.18` | measured, asserted |
| No sideways scroll at 375 px | `req › AC-005.9`, `board-phone`, detail | asserted |
| `/` is rendered per request, never cached (S0 SEC-2) | `platform › SEC-2 two GETs of / …` (different nonces, `Cache-Control` contains `no-store`) | @smoke |
| Back and resend never merges two requests (S0) | `subs › AC-001.7 S0 Back and resend` | @regression |
| `/inbox` returns 404 | `platform › /inbox returns 404` | @regression |
| The deployed commit is the one under test | `platform › health answers ok and reports the commit under test` | @smoke |
| Analytics events (FR-21, `docs/metrics-spec.md` QA checklist) | not observable from outside: `events` has no read operation. Not assessed (SQ-3) | n/a |
| Embed in a GHL iframe | none: no screen is embedded (NG-11, `X-Frame-Options: DENY`) | n/a |

## Fuzz run

`tests/fuzz/run.sh` and the Schemathesis run per role are QA2/QA3 work and are not part of QA1.

## Not tested, and why

| Item | Why |
|---|---|
| AC-005.4, AC-008.7, AC-011.2, AC-016.11 (empty inbox, empty week, no Lost requests, empty column) | The staging project is shared and holds other data, and requests cannot be deleted. Needs an empty Supabase branch or frontend component tests (SQ-5) |
| AC-005.5, AC-016.10 (51 requests, 51 in one column) | The 5-per-10-minutes limit allows no way to create 46+ requests in a run. Needs a seed (`bl-backend`, `supabase/seed.sql`) of 51 tagged rows (SQ-6) |
| AC-007.7 (audit record of a status change) and FR-21 events | No read operation exposes `quote_request_status_changes` or `events` (SQ-3) |
| AC-012.3 (a photo opens after two hours) | A two-hour wait inside a run is not practical; the signed URLs live 900 s and `GET .../photos` refreshes them: `detail › AC-002.8 (signed side)` checks fresh URLs work (SQ-4) |
| AC-003.5, AC-004.13 (counters unreadable) | Cannot be induced on a deployed preview without breaking the database |
| AC-001.13, AC-002.9 (database and bucket region) | Not visible from a browser; evidence is in the A2/OPS reports (SQ-1) |
| All live GoHighLevel behaviour (US-009, US-010, US-014 except AC-014.4, US-017) | `GHL_LOCATION_ID` and the token are unset on staging, and the PRD forbids any real GHL account. Covered offline by the INT1/INT2 simulator tests; **live GHL is unverified** |
| Real session expiry (7 days) | AC-004.7, AC-016.14 are run by answering the save with the contract's 401 `session_expired`; the server's time-boxing is a database rule (`supabase/tests`) |
| Network and storage failures (AC-001.8, AC-002.6, AC-005.7, AC-006.7, AC-007.6, AC-008.8, AC-011.4, AC-016.13, AC-016.15) | Simulated in the browser by aborting or answering the request (Playwright `route`); the staging database and storage are never taken down. The server-side "nothing partial is stored" halves are the backend's `tests/api` |
| Abuse and permission probes | Tagged `@probe`, QA2 |

## Spec questions (for the orchestrator)

| # | Question | Proposal |
|---|---|---|
| SQ-1 | AC-001.13 and AC-002.9 ask for the database and bucket region to be "inspected", which a browser cannot do | DevOps/architect attach the Supabase project's region evidence to the release brief; QA marks it INSPECT |
| SQ-2 | "Simulated 4G" (AC-001.10, AC-002.7) has no numbers | Use the WebPageTest "4G" profile: 9 Mbps down and up, 170 ms round trip. If the PM wants Lighthouse "slow 4G" (1.6 Mbps), AC-002.7 (15 MB in 20 s) cannot hold and the AC itself changes |
| SQ-3 | AC-007.7 and FR-21 need to read the status-change history and `events` | Give QA a read-only staging database role (or a staff-only read endpoint) for those two tables; or accept them as backend-tested |
| SQ-4 | AC-012.3 "after 2 hours" | Accept `GET .../photos` returning working fresh URLs as the proof (run), plus the unit test of the refresh-before-expiry rule |
| SQ-5 | Empty-state and "no Lost requests" criteria cannot be met on a shared project | A dedicated empty staging branch for QA, or move these to frontend component tests |
| SQ-6 | 51-request criteria | `bl-backend` seeds 51 tagged requests (51 Quoted) in `supabase/seed.sql` for staging |
| SQ-7 | The submission limit (5 per 10 minutes per address) makes a full run take about 12 minutes of waiting at worst | Accepted; the suite paces itself and orders its projects to overlap the wait. No bypass of the limit is requested |
| SQ-8 | AC-002.4 says a PDF or renamed text file is "refused with 'Photos must be JPEG, PNG or WebP' and is not stored". The deployed form keeps the refused file's row on screen with the message inside it (like AC-002.3, "refused next to that photo") | PM or designer confirm the row may stay. Attempt 3 changed `form › AC-002.4` to assert the message in the file's own row (the earlier "row disappears" assertion over-read the AC). The "not stored" half needs a send with a refused file on screen (one submission slot): **unverified**, QA can add it once the row behaviour is confirmed |
| SQ-9 | AC-016.2 says "drags"; FR-23 gives the Move to menu as the tap path. `docs/design-specs.md` open question 8 leaves a finger drag undecided. `board › AC-016.2 … touch pointer` asserts a finger drag moves a card and fails on staging (the card stays in New) | PM or designer decide. If a finger drag is not required, QA changes that test to assert the Move to menu path on a touch screen (already covered by `pipeline.phone › AC-016.17`) and removes the touch-drag test. Until then it stays red and is **not** a product ticket |
| SQ-10 | `docs/design-specs.md` names two accessible labels ("Open photo 2 of 3 at full size", "Move NQ-7K3M9P to another status") that the deployed app words differently ("View photo 2 of 3 at full size", "Move to another status, NQ-7K3M9P") | Designer or frontend choose which wording is right. Two `design wording` tests hold the design text and stay red until then (BUG-QA1-5, Minor); every behaviour test accepts either form |

## Changes made in attempt 3 (QA1)

| Change | Why |
|---|---|
| `support/ui.ts`: radios and the offers box are chosen by tapping their label, then asserted `checked` | The inputs are visually hidden inside a styled label, which intercepts `check()`; a person taps the label. Same assertion on the result |
| `support/ui.ts`: the 3-second form wait starts once the page has loaded | FR-8 stamps the form token when the server renders; timing from before `goto` could leave under 3 s after a slow first byte and the send got a 400 |
| `support/ui.ts`: `photoThumbs`, `photoThumb`, `moveButton` accept both label wordings | See SQ-10; the strict design wording has its own tests (`detail › design wording`, `requests › design wording`) |
| `detail › AC-005.7`: attaches the photo region's structure (URLs removed) | Evidence for BUG-QA1-3 |
| `detail › AC-012.1 AC-012.2`: the focus-trap loop moved to its own test, `detail › design: focus is trapped inside the open photo viewer` | The trap check failed first and stopped the test before its Escape, focus-return and scroll checks ran |
| `form › AC-001.2`: the urgency group is found as `group "How urgent is it?"` | The deployed group has role `group`, not `radiogroup` |
| `form › AC-002.4`, `late › AC-002.6`: the message is looked for in the file's own list item alert | See SQ-8 |
| `requests › AC-013`: the search box is the textbox "Search by reference, name or phone" plus its Search button | My locator matched the surrounding section |
| `requests › AC-007.2 AC-007.3 AC-007.5 AC-008.5`: the list order is recorded after the rows have loaded | It was recorded while the list was still empty |
| `board › AC-016.3`: "focus stays on that card" checks the focused control belongs to the moved card | The first check took the nearest `div`, which is not the card |
| `submissions › AC-002.7`: waits up to 60 s for the confirmation page, then asserts `< 20 s` | The page wait was 10 s, shorter than the AC's 20 s |
| `spine`: `vercel.live` (Vercel's preview toolbar) is allowed as a contacted host; every other third-party host still fails | The toolbar is injected by the platform on previews only |
| `spine`, `detail`: "$450.00 CAD" is matched across inline elements inside the "Your quote" form | The price and "CAD" are separate elements |
| `platform › health`: the default expected commit is `e966fbc` (`QA_EXPECTED_SHA` still overrides) | Commit under test |
| `support/fixtures.ts`: a console error names its resource (host and path, no query) | So a ticket can point at the failing request |

## Test-data cleanup

Requests cannot be deleted through the API (NG-7). Each run's requests are tagged `QA-E2E <run id>` and listed in `docs/qa-reports/qa-e2e-created.ndjson` and in `docs/qa-reports/latest-run.md`. Baseleap removes them by hand when asked. No other data is created: sign-in sessions are the two staff accounts that already exist.
