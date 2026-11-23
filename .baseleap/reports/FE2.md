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
