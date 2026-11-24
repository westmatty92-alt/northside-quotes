# QA1 tickets (Critical first)

Attempt 3, against https://northside-quotes-git-staging-baseleap.vercel.app at commit `e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79`. One ticket per root cause. No secret, token or personal data appears; traces under `test-results/` contain the bypass header and must not be shared or committed. Counts and per-criterion results: `docs/qa-reports/latest-run.md`.

| Ticket | Severity | Owner | Class | Status |
|---|---|---|---|---|
| BUG-QA1-2 | Critical (4 smoke tests fail) | bl-frontend | ui | open |
| BUG-QA1-3 | Important | bl-frontend | ui | open |
| BUG-QA1-4 | Important | bl-frontend | ui | open |
| BUG-QA1-6 | Important | bl-devops (first look) | env, cause unknown | open |
| BUG-QA1-5 | Minor | bl-frontend (or bl-designer) | ui / spec | open |
| BUG-QA1-1 | was Critical | bl-devops | env | **RESOLVED** |

---

## BUG-QA1-2 · Staff header logo link fails axe `label-content-name-mismatch` (serious) on every signed-in screen

| | |
|---|---|
| **Severity** | Critical by the QA rubric (four `@smoke` tests fail). In user terms it affects screen-reader and voice-control users on every staff screen, and the fix looks like one attribute. PRD FR-23 (Pipeline) and FR-5 ask for 0 serious or critical axe violations. |
| **AC / tests** | AC-004.1, AC-005.3, AC-005.10, AC-016.1, AC-016.16, AC-016.17, AC-016.19 (their functional assertions pass; the axe check is the last line of each). Failing, each also on the retry: `auth.desktop › AC-004.1` (smoke, desktop) · `requests › AC-005.10 AC-016.19` (smoke, phone and desktop) · `board › AC-016.1 AC-016.8` (smoke, desktop) · `pipeline.phone › AC-016.17` (smoke, phone) · `detail › AC-005.3 AC-016.5` (phone and desktop) · `screens › AC-016.16 AC-005.10` (phone and desktop) |
| **Class → owner** | `ui` → bl-frontend |
| **Signature** | `ui: staff header logo link aria-label "Northside Plumbing, Requests" does not contain its visible text (wordmark "NORTHSIDE PLUMBING · HAMILTON") → axe label-content-name-mismatch serious on /requests, /pipeline, /requests/{id}` |

**Steps to reproduce**
1. Sign in as the QA owner (`QA_OWNER_EMAIL`, `QA_OWNER_PASSWORD`) on the staging preview.
2. On `/requests`, `/pipeline` or any `/requests/{id}`, run axe with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`.

**Expected:** 0 serious or critical violations (PRD FR-23, FR-5; `docs/design-specs.md` "Target: WCAG 2.2 AA").
**Actual:** one violation, always the same element: `a[aria-label="Northside Plumbing, Requests"]`, rule `label-content-name-mismatch` (WCAG 2.5.3 Label in Name, level A): "Elements must have their visible text as part of their accessible name". The link shows the wordmark text "NORTHSIDE PLUMBING · HAMILTON" but its `aria-label` replaces that with a name that does not contain it. The public Request page and sign-in page are clean (their wordmark is not a link).
**Evidence:** every failing run reports exactly this one node. Traces (kept on failure): `test-results/auth.desktop-sign-in-smoke-df582-quests-current-and-Pipeline-desktop-retry1/` · `test-results/requests.both-tabs-are-sep-bd548-dress-and-is-marked-current-{phone-staff,desktop}-retry1/` · `test-results/pipeline.desktop-the-board-64872-st-each-card-with-its-facts-desktop-retry1/` · `test-results/pipeline.phone--smoke-AC-0-0b27c-page-never-scrolls-sideways-phone-staff-retry1/` · `test-results/detail.both-the-detail-scr-cb3c3--email-links-and-the-photos-{phone-staff,desktop}-retry1/` · `test-results/screens.both-staff-screens-011ed-nd-detail-structure-and-axe-{phone-staff,desktop}-retry1/`. Each holds an `axe-<screen>` attachment. Request ids: none apply (rendered markup; the page requests all returned 200).
**What would prove the fix:** those tests pass on the redeployed preview. Note: a test stops at its first failing axe check, so other violations on Pipeline or detail may show after this one is fixed.

---

## BUG-QA1-3 · A photo that cannot be loaded shows nothing: no "Photo unavailable" (AC-005.7)

| | |
|---|---|
| **Severity** | Important (an AC fails) |
| **AC / tests** | AC-005.7 · `detail › AC-005.7 when photo storage cannot be reached …` (phone and desktop), failing on the retry too |
| **Class → owner** | `ui` → bl-frontend. The API answers correctly (`GET /api/quote-requests/{id}/photos` 200 with URLs); the screen has no fallback when the browser cannot fetch the image. |
| **Signature** | `ui: request detail photo thumbnails (img) have no load-error fallback → no "Photo unavailable" slot when storage is unreachable (AC-005.7)` |

**Steps to reproduce:** sign in as the owner, open a request with 3 photos, block requests to `*/storage/v1/object/*` (browser dev tools "block request URL", or the test's `page.route(..., abort)`), reload the request.
**Expected** (AC-005.7; `docs/design-specs.md` SCR-06 Error): each photo slot says "Photo unavailable" and the rest of the request is shown.
**Actual:** the page renders and the rest of the request is shown, but 0 of 3 slots say "Photo unavailable". The photo region's structure (URLs removed) is `<button aria-label="View photo 1 of 3 at full size"><img alt="" … src=…><span aria-hidden="true">View photo 1</span></button>`, three times: an `<img>` with no error handling.
**Evidence:** traces `test-results/detail.both-the-detail-scr-33fb2-est-of-the-request-is-shown-{phone-staff,desktop}[-retry1]/trace.zip`, attachment `photo-region-structure`; request id of the photos call `yul1::yul1::h2sml-1795481143272-27c99ca52357` (200).
**Not covered:** the server-side half (a URL that could not be signed, the API's `url: null`): unverified, nothing on staging produces it.

---

## BUG-QA1-4 · Focus leaves the photo viewer: the third Tab lands on the page body

| | |
|---|---|
| **Severity** | Important (design-specs SCR-08 says focus is trapped inside; WCAG 2.4.3, modal dialog pattern). The AC text of US-012 does not mention it. |
| **AC / tests** | AC-012.1, AC-012.2 (these two pass: open, arrows, Escape, focus back on the thumbnail, scroll) · `detail › design: focus is trapped inside the open photo viewer` (phone and desktop), fails on the retry too |
| **Class → owner** | `ui` → bl-frontend |
| **Signature** | `ui: photo viewer dialog does not trap Tab: after the last control focus moves to <body> (SCR-08 Keyboard path)` |

**Steps to reproduce:** open a request with 3 photos, open the second thumbnail (focus is on Close), press Tab three times.
**Expected** (`docs/design-specs.md` SCR-08 "Keyboard path"): "Focus moves to Close on open and is trapped inside."
**Actual:** focus trail `Tab 1: <button> "Previous photo" inside dialog | Tab 2: <button> "Next photo" inside dialog | Tab 3: <body> "(page body)" outside the dialog`. Side note: on photo 1 the Previous button is paused (`aria-disabled`) yet still takes focus.
**Evidence:** `test-results/detail.both-photo-viewer-U-121bb-specs-SCR-08-Keyboard-path--{phone-staff,desktop}[-retry1]/trace.zip`.

---

## BUG-QA1-6 · Intermittent: browser uploads of photos to Supabase storage fail with `net::ERR_SSL_BAD_RECORD_MAC_ALERT`

| | |
|---|---|
| **Severity** | Important: it broke the done spine once. Root cause is **not known**; it may be the QA machine's network and not the product. |
| **AC / tests** | AC-001.1, AC-002.1 (done spine), AC-002.6 · `spine › the homeowner submits with 3 photos …` failed once; `late › AC-002.6 …` failed once. Both pass in the other runs (spine 3 of 4, AC-002.6 3 of 4 runs of the finished test). |
| **Class → owner** | `env`, unverified → bl-devops to look first (Supabase storage and Vercel logs); if the logs show the product closing connections, then bl-backend/bl-frontend |
| **Signature** | `env: intermittent net::ERR_SSL_BAD_RECORD_MAC_ALERT on direct browser PUTs to <project>.supabase.co/storage/v1/object/quote-photos/<id>/photo-N` |

**What happened (spine):** `POST /api/quote-requests` returned 201 (request id `yul1::yul1::fk5tx-1795482212690-8e5cb11e5d8c`), then the three uploads to `ckhkiarvfrfiwkvspduu.supabase.co/storage/v1/object/quote-photos/<id>/photo-1`, `photo-2`, `photo-3` all failed in the browser with `net::ERR_SSL_BAD_RECORD_MAC_ALERT`; the form stayed on `/`, no reference was shown, and a half-made request (created, no photos, never submitted) was left behind. By design (AC-002.6) it should not appear in the staff list; I did not check that for this one.
**What happened (AC-002.6):** photo-1 and photo-3 uploads hit the same error (request id of the create call `yul1::yul1::dstx9-1795483063547-421c9fb0f25e`); the app recovered, the resend returned 200 and the test's own assertions passed; only the console-error guard failed. A first occurrence was in the earlier full run (create call `yul1::yul1::8hxwl-1795481600202-b66c65c72108`).
**Expected:** uploads either succeed or fail with an HTTP error the page shows beside the photo (AC-002.6); a TLS record error should not occur.
**Not shown:** whether real homeowners on phones meet it. Rate: 2 of about 6 runs that uploaded photos from this machine.
**Unverified:** cause. For devops: check Supabase storage and edge logs around the ids above; compare with a second network.

---

## BUG-QA1-5 · Two accessible labels differ from `docs/design-specs.md` (Minor)

| | |
|---|---|
| **Severity** | Minor (the labels work and name the right thing) |
| **AC / tests** | none: the design spec only. `detail › design wording: each photo button is named "Open photo N of 3 at full size"` and `requests › design wording: each Move to button is named "Move NQ-... to another status"` (phone and desktop, each failing on the retry too). Every behaviour test accepts either wording. |
| **Class → owner** | `ui` → bl-frontend, or `spec` → bl-designer if the deployed wording is the better one (SQ-10 in `docs/test-plan.md`) |
| **Signature** | `ui: accessible names of photo thumbnails and Move to buttons do not match design-specs ("View photo N of 3 at full size" vs "Open photo N of 3 at full size"; "Move to another status, NQ-X" vs "Move NQ-X to another status")` |

**Expected** (`docs/design-specs.md` "Screen readers" and PhotoThumb): "Open photo 2 of 3 at full size"; "Move NQ-7K3M9P to another status".
**Actual:** "View photo 2 of 3 at full size"; "Move to another status, NQ-…".
**Evidence:** `test-results/detail.both-the-detail-scr-3ee41-toThumb-and-Screen-readers--{phone-staff,desktop}[-retry1]/` · `test-results/requests.both-status-from--15ba8-esign-specs-Screen-readers--{phone-staff,desktop}[-retry1]/`.

---

## BUG-QA1-1 · RESOLVED

Staging preview served 500 on `GET /` and 503 on the form-token and sign-in routes (attempts 1 and 2). Cause found from Vercel's logs: `CRON_SECRET` had trailing whitespace (`INVALID_CRON_SECRET`). Matthew fixed it and `staging` was rebuilt at `e966fbc`.
**Evidence of the fix (attempt 3):** `/api/health` 200 with version `e966fbc683ba3ae09b25c0be6b5d5f907c7a5c79`; `GET /` 200 with a form token and `no-store`; a made-up form token gets 401 `form_token_invalid` (was 503); `/inbox` 404; both staff accounts sign in. Tests: `platform.both.spec.ts` 4 of 4 and `auth.setup.ts` 3 of 3 pass, on the preflight, the targeted re-check and the full runs. Earlier request ids for the history: `GET /` `yul1::yul1::bksgf-1795476107311-f0e78f28b92e` (500), `POST /api/quote-requests` `yul1::yul1::bksgf-1795476109463-537c652a7160` (503).

---

## Not tickets: open questions for the orchestrator

- **SQ-9 finger drag (AC-016.2).** `board › AC-016.2 … touch pointer` fails because a finger drag does not move a card. The PRD asks for "drag" and gives the Move to menu as the touch path; `design-specs` open question 8 never decided. PM or designer: is a finger drag required? If not, QA replaces that test (the Move to path is already covered by `pipeline.phone › AC-016.17`).
- **SQ-8 refused photo rows (AC-002.4).** A refused PDF keeps its row on screen with the message inside it. The AC says it "is not stored"; that half is unverified.
- **AC-002.7 is marginal.** Three 5,242,880-byte photos on the assumed 4G profile (SQ-2: 9 Mbps, 170 ms) took 20 173 ms once and under 20 s in two other runs; the transfer alone is about 13.3 s. If the PM's "simulated 4G" is slower, the AC cannot hold.
- **Two 400 responses to confirm from the logs (backend).** `POST /api/quote-requests` returned 400 twice, each on a send under 3 seconds after the form had rendered (request ids `yul1::yul1::998r6-1795482228179-005bce4f516d` and `yul1::yul1::7fqd9-1795484463494-b0852649a27b`). I believe this is FR-8 working as designed (my test clock was wrong and is fixed, and the 400 no longer appears). If the log says another check refused them, that is a new ticket.
- **`vercel.live`.** The page contacts Vercel's preview toolbar on the preview (not part of the app). devops may turn it off for the staging preview if "no third-party widget" (AC-003.6) is to be shown on the preview itself.
