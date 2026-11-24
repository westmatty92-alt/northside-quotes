# STEP FE2: Staff shell, sign-in, Requests tab, request detail, weekly strip, photo viewer

## Attempt 1: 2026-11-23
**Status:** done, with the gaps listed under "Could not do". Nothing committed (no git, per the lane protocol). Built and checked locally against a production build (`next start`), not on a Vercel preview.

## Commands run (each with the `cd <lane> &&` prefix, one per call)
- `npm ci` -> exit 0 (596 packages, 0 vulnerabilities).
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; the same 2 warnings in `scripts/`, not mine).
- `npx vitest run src/components/staff --passWithNoTests=false` -> exit 0, 7 files, 139 tests. Also `npx vitest run src tests/unit` -> 14 files, 245 tests, all green (so FE1's tests still pass after my changes to `Button`, `Banner`, `Field`, `icon`, and the mock layer).
- Env-prefixed `npm run build` (`NEXT_PUBLIC_API_MOCKING=on NEXT_PUBLIC_SUPABASE_URL=... npm run build`) -> **refused** by the shell ("multiple operations"), same as FE1. Ran the plain `npm run build` instead -> exit 0; all routes dynamic (`/requests`, `/requests/[request_id]`, `/pipeline`, `/pipeline/[request_id]`, `/sign-in`). **The ledger's exact build command is unverified by me.**
- `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
- `node scripts/verify-ui.mjs http://localhost:3202 --step FE2 --serve "npm run start -- -p 3202" ... SCR-03 ... SCR-06--no-consent ... --click "SCR-06=button:has-text('View photo')" --allow-request "SCR-03--error=/api/"` -> exit 0, "12 view(s) of 6 screen(s) ... OK: no console errors, failed requests or axe violations". **One extra flag versus the ledger's list: `--env NEXT_PUBLIC_API_MOCKING=on`**, because my build had no env baked (the staff layout reads the flag on the server, `src/mocks/flag.ts`, so one build runs with mocks on or off). With the ledger's build (flag baked at build time) the flag is already `on`.
- Extra states, run to a separate folder `--step FE2-states` (22 views of 11 screens, exit 0, no console errors, no unexpected failed requests, axe clean): `SCR-03--ended`, `--paused`, `--unavailable`, `SCR-04--loading` (`?mockScenario=slow`), `SCR-04--error`, `SCR-04--menu` (Move to open), `SCR-06--loading`, `--error`, `--pipeline` (`/pipeline/mock-1`), `--sync` (copy failed with Retry), `--empty` (no photos, copy waiting).

## Screenshots
Folders: `/home/admin/baseleap/rehearsal/northside-quotes-wt-frontend/.baseleap/reports/FE2/` (the ledger's list) and `.../FE2-states/` (the extra states). 390 px and 1280 px each.

| Screen | Files | Matches mockup |
|---|---|---|
| SCR-03 sign-in | `FE2/SCR-03-{mobile,desktop}.png` | Yes: teal header, narrow sheet, Show button, "no sign-up" line; on 640 px and up a Paper sheet on a Fog page. |
| SCR-03 error | `FE2/SCR-03--error-*`, `FE2-states/SCR-03--{ended,paused,unavailable}-*` | Yes: one notice at a time above the form (401 red, 429 amber with the lock, 503 amber, session-ended info), email kept, notice has focus. |
| SCR-04 Requests | `FE2/SCR-04-*` | Yes: top bar with the tabs and "Signed in as Owner", strip 4/1/1, filter and search, six-column table at 1280, stacked cards at 390. The phone tab bar is fixed to the viewport, so a full-page screenshot draws it mid-page (the designer's screenshots draw it at the end). |
| SCR-04 empty / loading / error / menu | `FE2/SCR-04--empty-*`, `FE2-states/SCR-04--{loading,error,menu}-*` | Yes. Differences: line heights come from Tailwind's scale (DESIGN.md's numbers are not tokens), about 2 to 4 px off in places. |
| SCR-06 detail | `FE2/SCR-06-*` | Yes in layout and copy. The screenshot has the SCR-08 viewer open (the ledger's `--click` presses "View photo"), drawn over the page. |
| SCR-06 no consent | `FE2/SCR-06--no-consent-*` | Yes: "Not copied: no offers consent", no Retry, no stage tag line. |
| SCR-06 sync / empty / pipeline / loading / error | `FE2-states/SCR-06--*` | Yes. |
| SCR-08 viewer | open in `FE2/SCR-06-*` | Yes: ink background, title and reference, Close, 4:3 frame, Previous and Next. The photo is an inline stand-in SVG (mock mode). |

Console errors: 0 on every view. axe (WCAG 2.2 AA tags, phone width): 0 violations on every view, including the open dialog. Component tests also run axe-core on each state (contrast and landmarks off in jsdom; verify-ui covers them).

**Performance (from Next's `route-bundle-stats.json`, uncompressed):** `/requests` 966 kB, `/requests/[request_id]` and `/pipeline/[request_id]` 975 kB, `/` (FE1) 969 kB. **Gzip size is unverified** (gzip and pipes are refused in the shell); the 170 kB gz budget is likely at risk, as for `/` in FE1 (react-dom, the Next client, zod 4 and the generated Zod schemas, TanStack Query, supabase-js). All mock code (msw, faker, the seed data) is in dynamic chunks that load only when mocking is on; the 661 kB chunk is not in any route's first load. LCP, INP and CLS: not measured (no preview).

## Acceptance criteria
- **Navigation:** Requests `/requests` and Pipeline `/pipeline` in ONE `<nav aria-label="Main">`, restyled by breakpoint (top bar from 640 px, fixed 64 px bottom bar below), `aria-current="page"` on the current tab and `"true"` on the tab she came from while on a detail page, no List / Board switch, Sign out in the bar goes to `/sign-in` after `supabase.auth.signOut()` -> `staff-shell.test.tsx`.
- **SCR-03:** 401, 429 (one message for both limits, never says which), 503 `sign_in_unavailable`, session-ended notice, no forgot-password / sign-up / reset anywhere, email kept and password cleared after a failure, one press one attempt -> `sign-in-form.test.tsx`. After sign-in `next` is followed only when it passes the allow-list (own copy of `safeNextPath`, `next-path.ts`; see notes) -> `format.test.ts`.
- **401 session ended while saving:** `supabase.auth.signOut({ scope: 'local' })` finishes, THEN the page goes to `/sign-in?next=<path>&session=ended`; the order is asserted (`['signed out', 'navigated']`), it happens once for many failing calls, and the query cache is cleared -> `staff-shell.test.tsx`, `request-detail.test.tsx`, `requests-list.test.tsx`.
- **SCR-04:** newest first, 50 at a time with "Show more", status filter and search as client state (not in the URL), SCR-07 strip, a row changes status in place and keeps its position, leaves a filtered list at once, "Back to Requests" keeps filter, search and scroll -> `requests-list.test.tsx`.
- **SCR-06** at `/requests/[id]` and `/pipeline/[id]`: price and note (cents, 2 decimals, range, 1,000 characters, error summary with links, values kept, saved, could not save, "Try saving again"), status change, 409 stale version shows the designed message with Reload and keeps the typed note, GHL copy and stage-tag lines, "Not copied: no offers consent" with no Retry and no stage-tag line, Retry copy (Could) -> `request-detail.test.tsx`.
- **SCR-08:** plain `<img src={signed url}>` (never next/image; asserted: no `/_next/image`, no `srcset`), fresh URLs when it opens, 60 seconds before the earliest expiry (never under 5 seconds) and when an image fails, "Photo unavailable" with Try again, Previous and Next paused at the ends with no wrap, Left and Right keys, focus on Close and back on the thumbnail, "Photo N of M" announced -> `photo-viewer.test.tsx`.
- **Mock scenarios** (`?mockScenario=`, read only in `src/mocks/**`): `signed-in` (also the default for staff pages), `empty`, `error`, plus `session-ended`, `slow`, `stale`, `save-failed`, `paused`, `unavailable`. Seeded ids `mock-1` (offers box ticked, 3 photos) and `mock-2` (not ticked, **2 photos**, see notes) -> `staff-handlers.test.ts`. Every mock success body is checked against the generated Zod schema in that test.

## Files changed (all inside the owned paths)
**Pages and layout**
- `src/app/(public)/sign-in/page.tsx`: SCR-03 (replaces the placeholder); reads `next` and `session` and passes `next` through the allow-list.
- `src/app/(staff)/layout.tsx`: new; mounts the staff shell once.
- `src/app/(staff)/requests/page.tsx`: SCR-04.
- `src/app/(staff)/requests/[request_id]/page.tsx`, `src/app/(staff)/pipeline/[request_id]/page.tsx`: SCR-06 under each tab (the `request_id` is checked as one plain path segment, otherwise 404 page).

**`src/components/staff/`**: `staff-shell.tsx` (providers, top bar, tabs, sign out), `tab-nav.tsx`, `staff-session.tsx` (bearer token, sign out, session ended), `staff-query-client.ts` (reads retry once, never mutations, any 401 ends the session), `queries.ts` (generated hooks and fetchers with Zod-checked `select`), `staff-page.tsx` (measure, shared with FE3), `requests-list.tsx`, `request-row.tsx`, `move-to-menu.tsx`, `status-badge.tsx`, `week-count.tsx`, `request-detail.tsx`, `quote-form.tsx`, `status-control.tsx`, `ghl-card.tsx`, `photo-gallery.tsx`, `photo-viewer.tsx`, `sign-in-form.tsx`, `sign-in-preview.ts`, `next-path.ts`, `navigation.ts`, `request-id.ts`, `format.ts`, `copy.ts`, `test-support.tsx`; tests `format.test.ts`, `sign-in-form.test.tsx`, `staff-shell.test.tsx`, `week-count.test.tsx`, `requests-list.test.tsx`, `request-detail.test.tsx`, `photo-viewer.test.tsx`.

**`src/components/ui/`**: `skeleton.tsx` (new); `icon.tsx` (added the staff icons, same 2 px outline family); `banner.tsx` (optional `icon` and `urgent`: an amber refusal can announce as an alert, as the mockup does); `button.tsx` (props now `ComponentProps<'button'>`, so a ref can be passed); `field.tsx` (label may carry a lighter "(optional)").

**`src/hooks/`**: `use-staff-request.ts` (the `request` option every generated staff hook takes), `use-list-view.tsx` (filter, search, scroll, kept while the layout stays mounted), `cell.ts`.

**`src/mocks/`**: `staff-data.ts`, `staff-handlers.ts` (the staff API with the contract's statuses and problem+json), `scenarios.ts`, `handlers.ts`, `previews.ts`, `browser.ts`, `mock-provider.tsx` (now also seeds the sign-in form); test `staff-handlers.test.ts`.

**Reports:** `.baseleap/reports/FE2.md`, `.baseleap/reports/FE2/*`, `.baseleap/reports/FE2-states/*`.

## CONTRACT QUESTION
1. **`src/proxy.ts` (backend-owned): mock mode cannot get past the sign-in redirect once the proxy is merged.**
   - Need: with `NEXT_PUBLIC_API_MOCKING=on`, a request to `/requests`, `/pipeline` or a detail path must reach the page with no Supabase session.
   - Why: the proxy redirects a signed-out visit to `/sign-in?next=...` (it validates the `sb-*` cookie with `getClaims()`), and nothing in my owned files runs before it, so I cannot satisfy this from the frontend. It is not blocking now because the lane has no `src/proxy.ts` yet; **it will block `verify-ui` for SCR-04 and SCR-06 on the merged tree and on any preview with mocking on**.
   - Artifact: `src/proxy.ts`, step 3 ("A signed-out visit to /requests ... is redirected"), and `docs/SECURITY_MODEL.md` invariant 22.
   - Suggested change: skip only the signed-out redirect when `process.env.NEXT_PUBLIC_API_MOCKING === 'on' && process.env.VERCEL_ENV !== 'production'` (pages hold no data; every `/api` route still authorises itself). The CSP and nonce stay on.
2. (Not blocking) `src/lib/api/fetcher.ts` is not in my owned list this step, so the staff bearer token is attached by `useStaffRequest()` (a `request` option whose `Authorization` header is read at call time) instead of inside `apiFetch`. It works and is tested (a refreshed token is used by the next call), but every staff call site must pass `request`. If the architect or FE1's owner puts the token lookup into `apiFetch`, `useStaffRequest` becomes an empty object and no screen changes.

## Could not do / unverified
- **Env-prefixed build command** (see above) and **gzip first-load JS** (see above).
- **Not run on a Vercel preview** (no push by me).
- **Real-browser behaviour of the native `<dialog>`** (Escape closes it, focus is trapped, the page behind is inert) and of the Move to menu's keys: component tests cover them with a `showModal()`/`close()` stand-in and `fireEvent`, and verify-ui proves the dialog opens and is axe-clean, but I could not start an interactive browser session (the run-code tool needs permission I do not have). **QA should press Escape on the viewer and Tab around it on the preview.**
- **Real Supabase session path** (the token from `getSession()`, `signOut`, the cookie hand-off after `signIn`): tested with a stand-in for `getSessionClient()`, never against a real Supabase project or the real backend.
- **Pipeline placeholder:** `src/app/(staff)/pipeline/page.tsx` (FE3's) still renders its own `<main>`, and my layout already provides the one `main` landmark, so `/pipeline` has two nested mains until FE3 replaces it. FE3 should render inside `StaffPage` (and `wide` for 1,280 px) and no `<main>`.
- The viewer's 4:3 frame is sized by width (as the mockup); on a window shorter than about 880 px the frame can overflow and the dialog scrolls.

## Notes for the orchestrator and the next steps
- **Deviations from the design copy, for the designer to confirm:**
  - The thumbnail button's name is "View photo N of 3 at full size" (design: "Open photo N of 3 at full size") and each tile shows the words "View photo N". The ledger's click selector `button:has-text('View photo')` needs those visible words, and a visible label that is contained in the accessible name satisfies WCAG 2.5.3.
  - The Move to button's name is "Move to another status, NQ-7K3M9P" (design example: "Move NQ-7K3M9P to another status"), so the name starts with the visible words "Move to".
  - Words the design does not give, marked `(FE2)` in `src/components/staff/copy.ts`: "Enter your email address." / "Enter your password." on SCR-03, "Couldn't sign in. Try again." (no answer from the server), "The retry could not run." (409 not_retryable).
- **`mock-2` has 2 photos, not none.** The ledger's `--click "SCR-06=button:has-text('View photo')"` also applies to `SCR-06--no-consent` (the ledger matches the base id), so that page needs a photo to click. The no-photos state is covered by `a0000000-0000-4000-8000-000000000004` (Tomasz Kowalski) in `FE2-states/SCR-06--empty-*` and by tests.
- **Ids:** `mock-1` and `mock-2` are aliases for the first two seeded uuids (the contract's ids are uuids; the generated Zod schemas refuse anything else). Rows in the list link to the uuids, so those never hit the aliases.
- **`safeNextPath`:** `src/lib/server/auth/next-path.ts` is not in this lane, so `src/components/staff/next-path.ts` holds the same rule (invariant 22). After the merge, either can import the other; the backend's version is the source of truth.
- **For FE3 (Pipeline):** reuse `useStaffRequest()` on every generated staff hook, `StaffPage`, `WeekCount`, `MoveToMenu`, `StatusBadge`, `RequestRow`'s pattern, `listQueryPrefix` and `getGetCurrentWeeklyCountQueryKey()` to invalidate after a move, `useRequestList`'s pattern for cursors, and `createStaffQueryClient`'s 401 handling (any staff mutation that fails with 401 ends the session). The list invalidates the shared prefix `['/api/quote-requests']`, so a status change on either tab refreshes the other.
- **Tailwind trap (new, same family as FE1's `font-h1`):** `theme.css` defines `--spacing-xs` to `--spacing-2xl`, and Tailwind resolves `max-w-xs`, `max-w-md` and friends to those spacing tokens (4 to 48 px), not to container widths. Use numeric widths (`max-w-80`, `max-w-112`). I hit this twice (search box and empty-state text collapsed) and fixed it.
- **Refused command shapes this step:** env-prefixed `npm run build`; `node -e`; `cd ... && grep ... | head`; `wc`; background `npm run start` with an env prefix. Plain `npm run`, `npx vitest`, `node scripts/...`, `ls`, `grep` (single command) work.
- The old FE1 leftovers still to delete (no `rm` for me): `src/components/providers/app-providers.tsx`, `src/components/site/public-page.tsx`, `src/components/site/site-chrome.tsx`, `src/components/site/wordmark.tsx`.

## Attempt 2: QA1 fixes (2026-11-23)

**Status:** partial. Every code fix and its component test is done and green. `verify-ui` fails on SCR-06 for a reason I cannot clear (see "verify-ui" below).

Read: the four tickets in `.baseleap/reports/QA1-errors.md`, `docs/design-specs.md` (SCR-06, SCR-08, PhotoThumb, Wordmark, Screen readers), `design/mockups/SCR-06-request-detail.html`, QA's `tests/e2e/detail.both.spec.ts` and `pipeline.desktop.spec.ts` plus `support/ui.ts` (read only), axe-core 4.14.1's `label-content-name-mismatch` source.

### Why jsdom never caught BUG-2, and the test helper that does
The generic axe run in the old tests passes on the broken header because axe cannot decide this rule in jsdom. With no layout nothing counts as visible text, and without a canvas axe's icon-ligature check throws, so the rule ends up "needs review", not a violation. `expectLabelsContainVisibleText` (new, `src/components/staff/test-support.tsx`) gives axe a box per element and a canvas stand-in for the length of the run, then restores them. It also fails if axe checked nothing. It runs only `label-content-name-mismatch`, which is tagged `wcag21a` (QA's tags include it; `verify-ui` uses `wcag21aa` and does not, which is why FE2 attempt 1 never saw it).

### BUG-QA1-2 (Critical): header logo link
- **Reproducing test:** `staff-shell.test.tsx` "the header logo link is named with its visible wordmark text first, and the frame has no axe violation (WCAG 2.5.3)" (renders `StaffShell`), plus negative controls in `tmp-debug.test.tsx` (the helper fails on the old link).
- **Red:** failed with `label-content-name-mismatch (serious): <a href="/requests" aria-label="Northside Plumbing, Requests">`.
- **Root cause was two things.** (1) The aria-label did not contain "Hamilton". (2) Fixing the label alone left the test red: axe joins the wordmark's two SVG `<text>` elements with no space, so the visible text it compares is "NORTHSIDEPLUMBING · HAMILTON" and no sensible label can contain that.
- **Fix:** `copy.ts` `nav.home` is now "Northside Plumbing, Hamilton: Requests" (starts with the visible words, still says where it goes). `src/components/ui/site/wordmark.tsx` now draws its two lines as two `<tspan>`s of one `<text>` with a space between them, each keeping its own x/y, so the visible text reads "NORTHSIDE PLUMBING · HAMILTON". The drawing is unchanged (checked on the sign-in screenshot, `.baseleap/reports/FE2/SCR-03-desktop.png`). The public pages share this component and are unchanged too.
- **Green:** same test passes; `tmp-debug2.test.tsx` pins the wordmark's text with its space.
- **Unverified:** in a real browser on the staging preview (no way past the proxy, below). QA's axe run on the redeployed preview is the proof. Axe may then show other violations that the first failure hid, as QA warned.

### BUG-QA1-3 (Important): "Photo unavailable" when an image cannot load
- **Design:** SCR-06 Error: "Photo storage unreachable: each photo slot says 'Photo unavailable' and the rest of the page shows." Same slot as the existing `url: null` case.
- **Reproducing tests** (`photo-viewer.test.tsx`): "Storage unreachable: every slot whose image fails says 'Photo unavailable', the rest of the request still shows, and fresh URLs are asked for once" and "one photo that fails does not take the others with it, and it comes back when a fresh URL loads".
- **Red:** both failed with "Unable to find an element with the text: Photo unavailable".
- **Fix** (`photo-gallery.tsx`): a thumbnail's `onError` now marks that slot (it remembers the URL that failed) and the slot renders the unavailable panel at once. It still asks for fresh URLs, but once per photo until an image loads and as one request however many fail together. Before, a set of URLs that all failed would ask again for every new set (a loop while Storage is down). A fresh URL for the same photo is tried again; if it fails too the slot stays "Photo unavailable" with no new request (the test checks the request count stays 1). The hint under the photos switches to "The rest of the request is still shown. Reload the page to try the photos again." for these too.
- **Green:** both pass, with axe clean on the failed state. A slot can flash the picture again for a moment while a fresh URL is tried; I accepted that.

### BUG-QA1-4 (Important): focus leaves the photo viewer
- **Cause:** a native modal `<dialog>` makes the page behind inert but its Tab order ends at the browser's own controls, so after the last button focus goes to the body (what QA saw).
- **Reproducing tests** (`photo-viewer.test.tsx`): "Tab keeps focus inside the dialog and cycles Close, Previous photo, Next photo, Close", "Shift+Tab from Close goes to the last control, and back", "the trap still holds on the last photo, where Next is paused but stays in the Tab order", "Escape closes the viewer and puts focus back on the thumbnail that opened it". jsdom has no Tab key, so `pressTab()` sends the keydown and, if the page did not stop it, plays the browser's default (next control inside the dialog; past the last: out of the page).
- **Red:** 4 failed: "Tab 3 left the dialog: focus trail Previous photo > Next photo > ..." (the same trail as QA), and Escape left the dialog open.
- **Fix** (`photo-viewer.tsx`): the dialog's own `onKeyDown` wraps Tab from the last control to the first and Shift+Tab from the first to the last. Escape is now handled explicitly (`dialog.close()`, one path that hands focus back to the thumbnail) as well as by the browser. The paused Previous/Next buttons (`aria-disabled`, not `disabled`) stay in the Tab order, as the project's `Button paused` pattern has it; QA's side note about that is the designed behaviour, not changed.
- **Green:** all four pass, with the existing open/close/arrows tests. **Not run in a real browser** (Escape and the trap in Chromium are for QA's `design: focus is trapped inside the open photo viewer` on the preview).

### BUG-QA1-5 (Minor): accessible names
- **Photo thumbnails: aligned to the spec.** Button name "Open photo N of 3 at full size" (design-specs PhotoThumb and Screen readers); tile text "Photo N" (the SCR-06 mockup). The name contains the visible words, so WCAG 2.5.3 holds (test: "are named 'Open photo N of 3 at full size' and show 'Photo N' on the tile; the name contains the visible words"). `request-detail.test.tsx` and `photo-viewer.test.tsx` use the new names. I wrote the fix and the test together; there is no separate red run for this one, but the negative control in `tmp-debug.test.tsx` shows the helper fails the old pairing ("Open photo ..." on a tile reading "View photo 2").
- **Move to: the spec is wrong, so the deployed name stays.** design-specs wants "Move NQ-7K3M9P to another status" with the visible text "Move to". "Move" and "to" are not together in that name, so axe's `label-content-name-mismatch` fails it (serious, WCAG 2.5.3). The negative control in `tmp-debug.test.tsx` proves it. "Move to another status, NQ-7K3M9P" starts with the visible words, carries the reference, and passes. FE3's board uses the same `moveLabel`, and its tests (`^Move to another status`) are unaffected. New test in `requests-list.test.tsx`: every Move to button is named with its visible words first, and passes the label-in-name check. **Needs the designer:** change the spec wording to "Move to another status, NQ-7K3M9P" (design-specs "Screen readers", and the MoveToMenu line if there is one). QA's `design wording: each Move to button is named "Move NQ-... to another status"` (SQ-10) will keep failing until the spec and that test change; it should not be satisfied by changing the app.

### SQ-9: finger drag by the grip
- **Result: it works as FE3 designed it, in the logic.** New file `src/components/staff/pipeline/touch-drag.test.tsx` (5 tests, all pass) drives the real `PipelineBoard` with touch pointer events: pressing the grip, moving over Won and lifting saves `to_status: won` with the version she saw, the card moves there and "NQ-7K3M9P moved to Won" is announced; New to Quoted and Quoted to Lost; a `pointercancel` puts the card back with nothing stored; another pointer is ignored; the grip carries `touch-none` and a press on the rest of the card does not drag. I added a new file and did not edit FE3's tests or code.
- **Why QA's `board › AC-016.2 ... touch pointer` still fails.** `touchDrag` in `tests/e2e/support/ui.ts` presses the centre of the card and long-presses. By design a finger only picks a card up by the grip (`[data-grip]`), so the card centre is a page scroll, not a drag. The test must press the grip (it is `aria-hidden`, so target it by `[data-grip]` inside the card) and then move.
- **Real finding for FE3 (not mine to edit).** `board-card.tsx` renders the grip as `className="hidden touch-none ... xl:inline-flex"`, so it is only displayed from 1280 px. Below that a finger has no handle and the Move to menu is the only touch path. If the ruling means finger drag at tablet and phone widths too, the grip must be displayed at those widths (drop `hidden`/`xl:inline-flex`, keep `touch-none`, and give it a 44 px target as the design's touch rule says). At 1280 px and above it is there.
- **Unverified in a real browser (cannot reach /pipeline, below):** (a) whether Chromium keeps delivering the touch's pointer events to the window after the card turns into the dashed gap, because the touch's implicit capture target (the grip) sits inside the `inert`/`invisible` div of the lifted card. If it does not, the fix in `use-board-drag.ts` is one line at the start of `onCardPointerDown`: `if (event.pointerType === 'touch' && event.target instanceof Element) event.target.releasePointerCapture?.(event.pointerId)`, so events follow the finger, not the lifted element. (b) That the browser does not send `pointercancel` itself (`touch-none` on the grip should prevent it).

### Commands run (each with the `cd <lane> &&` prefix)
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; 2 warnings in `scripts/` that are not mine).
- `npx vitest run src/components/staff --passWithNoTests=false` -> exit 0, 11 files, 184 tests pass. `npx vitest run src` -> 18 files, 290 tests pass.
- `NEXT_PUBLIC_API_MOCKING=on ... npm run build` -> refused again (env-prefixed command). Built plain: `npm run build` -> exit 0 (all routes listed; `Proxy (Middleware)` present).
- `node scripts/check-code-guards.mjs generated` -> exit 0, "check-code-guards generated: OK".
- FE2's verify-ui command (as in the step entry) -> exit 1, see below.

### verify-ui
Exact result: `12 view(s) of 6 screen(s)`, 4 problems, all `console error: verify-ui: locator.click: Timeout 10000ms exceeded.` on SCR-06 and SCR-06--no-consent (mobile and desktop). The cause is the proxy: `.baseleap/reports/FE2/SCR-04-desktop.png` shows the Staff sign-in page, so `/requests` and `/requests/mock-1` were redirected to `/sign-in`, where there is no photo button to click. SCR-04 and SCR-04--empty "pass" only because they were looking at the clean sign-in page (not a real check of the Requests tab). SCR-03 and SCR-03--error pass. I did not work around the proxy.

**Second problem waiting behind the first (decide before the proxy is fixed).** The step entry's click is `--click "SCR-06=button:has-text('View photo')"`. After BUG-QA1-5 the tile shows "Photo N" (the spec and mockup), so that selector no longer matches anything, even with a session. Change the step entry to something like `--click "SCR-06=button[aria-label^='Open photo']"`. I kept to the spec because the ruling was to align with it; if you prefer to keep the ledger command, the alternative is to make the spec and mockup say "View photo" (name "View photo N of 3 at full size", tile "View photo N", as attempt 1 had it) and leave QA's design-wording test to the designer.

### Files changed
- `src/components/staff/copy.ts` — `nav.home`, photo tile text and name, comment on `moveLabel`.
- `src/components/ui/site/wordmark.tsx` — one `<text>` with two `<tspan>`s and a space.
- `src/components/staff/photo-gallery.tsx` — failed-thumbnail state, bounded refresh.
- `src/components/staff/photo-viewer.tsx` — Tab wrap and explicit Escape.
- `src/components/staff/test-support.tsx` — `expectLabelsContainVisibleText`.
- `src/components/staff/staff-shell.test.tsx`, `photo-viewer.test.tsx`, `request-detail.test.tsx`, `requests-list.test.tsx` — the new and updated tests.
- `src/components/staff/pipeline/touch-drag.test.tsx` (new) — SQ-9.
- `src/components/staff/tmp-debug.test.tsx`, `src/components/staff/tmp-debug2.test.tsx` (new): negative controls for the helper and the wordmark text pin. The names are leftovers of my debugging and I have no `rm` or `mv`; they are real tests, please rename them (for example `label-in-name.test.tsx` and `wordmark.test.tsx`).
- `.baseleap/reports/FE2.md`, `.baseleap/reports/FE2/*` (re-written by verify-ui).

### Not mine, for the orchestrator
- The designer: Move to wording in the spec (above); QA: the touch-drag test must start on the grip, and the photo design-wording test now matches.
- FE3: grip display below 1280 px (above), only if finger drag is wanted on phones and tablets.
- `CONTRACT QUESTION` 1 from attempt 1 (proxy in mock mode) is now the live blocker for `verify-ui` on SCR-04 and SCR-06. No new contract question.

## Attempt 2b: View photo wording (2026-11-24)
**Status:** done. Per the ledger ruling of 2026-11-24: the photo tile shows "View photo N" and its accessible name is "View photo N of 3 at full size" (visible words first, so label-in-name holds). The Move to button keeps "Move to another status, NQ-...". The photo viewer dialog title ("Photo N of 3") is unchanged. Nothing committed by me (no git).

**Files changed**
- `src/components/staff/copy.ts`: `detail.viewPhoto` now `View photo N`; `detail.viewPhotoLabel` now `View photo N of T at full size`; comment updated.
- `src/components/staff/photo-viewer.test.tsx`: thumb lookup, the tile wording test, and the `/Open photo/` queries now use `View photo`.
- `src/components/staff/request-detail.test.tsx`: the three-tile assertion now matches `/^View photo \d of 3 at full size$/`.
- `src/components/staff/label-in-name.test.tsx`: the photo case keeps both checks (new wording passes; the old "Open photo" name against "View photo 2" text still fails), retitled.
- `src/components/staff/photo-gallery.tsx` needed no change (it reads both strings from copy).

**Commands run (each with the `cd <lane> &&` prefix)**
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; the same 2 warnings in `scripts/`, not mine).
- `npx vitest run src/components/staff --passWithNoTests=false` -> exit 0, 11 files, 184 tests (label-in-name and axe tests included).
- `npm run build` -> exit 0.
- `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
- `verify-ui` not run, as instructed. Staff-screen visual evidence comes from QA on the staging preview (FE2V).

**Not mine:** QA e2e tests in `tests/e2e/**` that look for "Open photo" or "Photo N" tiles, if any, need the new wording (not searched, outside my paths).
