# STEP FE3: Pipeline tab (SCR-05)

## Attempt 1: 2026-11-23
**Status:** done. Nothing committed (no git, per the lane protocol). Built and checked locally against a production build (`next start`), not on a Vercel preview.

## Commands run (each with the `cd <lane> &&` prefix)
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; the same 2 warnings in `scripts/`, not mine).
- `npx vitest run src/components/staff/pipeline --passWithNoTests=false` -> exit 0, 1 file, 26 tests. Also `npx vitest run src tests/unit` -> 15 files, 271 tests, all green (FE1 and FE2 tests, `mocks.test.ts` and `staff-handlers.test.ts` still pass with the new scenario).
- Env-prefixed `NEXT_PUBLIC_API_MOCKING=on ... npm run build` -> **refused** by the shell ("multiple operations"), as you expected. Ran the plain `npm run build` -> exit 0; `/pipeline` and `/pipeline/[request_id]` are dynamic (`ƒ`). **The ledger's exact build command is unverified by me.**
- `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
- `node scripts/verify-ui.mjs http://localhost:3203 --step FE3 --serve "npm run start -- -p 3203" --env APP_SIGNING_SECRET=... SCR-05=/pipeline?mockScenario=signed-in SCR-05--save-failed=/pipeline?mockScenario=save-failed --allow-request "SCR-05--save-failed=/api/"` -> exit 0, "4 view(s) of 2 screen(s) ... OK: no console errors, failed requests or axe violations". **One extra flag versus the ledger's list: `--env NEXT_PUBLIC_API_MOCKING=on`**, because my plain build has no flag baked in (the staff layout reads it on the server at run time, `src/mocks/flag.ts`). With the ledger's env-prefixed build it is already on.
- Extra states, run to `--step FE3-states` (10 views of 5 screens, exit 0, console clean, axe clean): `SCR-05--moving` (`mockScenario=moving`), `--stale`, `--empty`, `--loading` (`slow`, `--wait load`), `--error`.

## Screenshots
Folders: `.baseleap/reports/FE3/` (the ledger's list) and `.baseleap/reports/FE3-states/` (extra states), 390 px and 1280 px each, under `/home/admin/baseleap/rehearsal/northside-quotes-wt-frontend/`.

| Screen | Files | Matches mockup |
|---|---|---|
| SCR-05 board | `FE3/SCR-05-{mobile,desktop}.png` | Yes: title, strip, the one-line about text, four columns at 1280 (Fog columns, Paper cards, reference tag, grip, urgency chip, time, full-width Move to), one column plus the "Jump to a column" row at 390. The phone tab bar is fixed to the viewport, so a full-page screenshot draws it mid-page (same as FE2). |
| SCR-05 save failed | `FE3/SCR-05--save-failed-*` | Yes: the move to Won was tried once on load, refused (500); "Couldn't save. Try again." with "NQ-7K3M9P is still in New. Nothing was changed and the weekly count is the same."; the card is back in New in its time position; focus ring on its Move to; the weekly strip still 4, 1, 1. |
| SCR-05 moving (Saving) | `FE3-states/SCR-05--moving-*` | Yes in layout: the card sits in Won at its time position (first, 9:10), marked "Saving", Move to paused. Difference: the paused button is shorter than 44 px, see Findings 1. |
| SCR-05 empty | `FE3-states/SCR-05--empty-*` | Yes: four dashed empty columns with their own messages, strip 0, 0, 0. |
| SCR-05 loading | `FE3-states/SCR-05--loading-*` | Yes: four skeleton columns (2, 2, 1, 1 cards) and skeleton tiles; no about line or jump row (as the mockup). |
| SCR-05 error / stale | `FE3-states/SCR-05--error-*`, `--stale-*` | Yes by inspection of the DOM and tests; the screenshots are there. |
| Dragging | not reachable by URL (needs a pointer) | Covered by component tests only; **not seen in a browser**. |

Console errors: 0 on every view. axe (WCAG 2.2 AA tags, phone width): 0 violations on every view. Component tests also run axe-core on success, loading, empty, error, saving, refused, stale and mid-drag.

**Performance:** not measured (no preview, and gzip is refused in the shell, as in FE2). The route adds only components; mock code is still in dynamic chunks. First-load JS gz for `/pipeline`: **unverified**; likely the same as `/requests` (see FE2: react-dom, Next client, zod 4, TanStack Query, supabase-js).

## Acceptance criteria
- **StaffPage, one `main`:** the placeholder's own `<main>` is gone; the page renders `PipelineBoard` inside `StaffPage wide` (1,280 px) -> `src/app/(staff)/pipeline/page.tsx`, verify-ui axe clean.
- **Four fixed columns, one call each by status, never `q`, every request shown:** `usePipeline` calls `useRequestList({status})` four times in parallel; "Show more" per column (50 at a time) -> test "Success" (calls: lost, new, quoted, won; no `q`; `limit=50`) and "51 cards in one column".
- **Move to menu and drag call changeQuoteRequestStatus with the version, with `useStaffRequest()`:** `useChangeQuoteRequestStatus({ request })` -> "opens with the arrow key..." (body `{to_status:'won', version:1}`), "dropping into another column saves that status", "the next move of the same card carries the new version" (2).
- **Saving state:** the card moves to the new column at once, marked "Saving", its Move to `aria-disabled`, a second press does nothing -> same tests.
- **Failure or 409 reverts, nothing stored, visible message:** the card returns to its column and time position, "Couldn't save. Try again." / "This request was changed by someone else. Reload to see the latest." with Reload (refetches all four columns); no refetch and no weekly count call on failure; focus back on the card's Move to -> "a failed save", "someone else changed it first (409)", "a failed drop".
- **401:** the card goes back, no message on this screen, `navigateTo('/sign-in?next=/pipeline&session=ended')` -> "a session that ended".
- **Live region:** "NQ-7K3M9P moved to Won" in a polite `role="status"` that exists from the start -> "opens with the arrow key...".
- **Escape cancels a drag; letting go outside the columns or in the card's own column stores nothing; a press that hardly moves is a click** -> five drag tests. A mouse picks a card up anywhere except its buttons; a finger or pen only by the grip (`touch-action: none` on the grip, so the page still scrolls).
- **Keyboard path:** Tab reaches the reference link then Move to; ArrowDown opens, arrows and Enter choose, Escape closes and returns focus -> "Move to" tests (MoveToMenu is FE2's, reused unchanged).
- **Weekly strip fetches again after each successful move:** `getGetCurrentWeeklyCountQueryKey()` and the list prefix are invalidated -> `weekCalls` rises after release, and does not on failure.
- **Moved card takes its time position, never the top:** a Lost card (Nov 12) moved to Won lands between Nov 13 and Nov 10 -> "a moved card takes its submitted-time position".
- **Cards open /pipeline/[id]:** the reference tag is the link (`/pipeline/<uuid>`).
- **No column controls, no List / Board switch:** asserted.
- **Mock scenarios (src/mocks only; the page never reads `?mockScenario`):** `signed-in` and `save-failed` as asked, plus `moving` (the status change never answers: Saving stays), and `stale`, `empty`, `error`, `slow` reused. `stale`, `save-failed` and `moving` make the board move NQ-7K3M9P (New to Won) once it has loaded, through `PipelinePreviewContext` (provided by `src/mocks/mock-provider.tsx`; nothing provides it in a normal run) -> "mock scenarios on /pipeline" tests.

## Files changed (all inside the owned paths)
- `src/app/(staff)/pipeline/page.tsx`: SCR-05 page, replaces the placeholder.
- `src/components/staff/pipeline/pipeline-board.tsx`: the screen (states, banners, live region, focus handling).
- `src/components/staff/pipeline/use-pipeline.ts`: four column queries, the move with Saving, revert, 409, refetch.
- `src/components/staff/pipeline/use-board-drag.ts`: pointer-event drag (no library, no new dependency).
- `src/components/staff/pipeline/board-column.tsx`, `board-card.tsx`: column and card (and the dragged picture).
- `src/components/staff/pipeline/copy.ts`: the board's own words (the shared `copy.ts` is not mine).
- `src/components/staff/pipeline/pipeline-icons.tsx`: grip and "moving" icons, drawn locally (see Findings 2).
- `src/components/staff/pipeline/pipeline-preview.ts`: the context seam for mock scenarios.
- `src/components/staff/pipeline/pipeline-board.test.tsx`: 26 tests.
- `src/mocks/scenarios.ts` (`moving`, docs), `src/mocks/previews.ts` (`pipelinePreviewFor`), `src/mocks/browser.ts` (new seed), `src/mocks/mock-provider.tsx` (provides it), `src/mocks/staff-handlers.ts` (`moving` hangs the status change).
- Reports: `.baseleap/reports/FE3.md`, `.baseleap/reports/FE3/*`, `.baseleap/reports/FE3-states/*`.

## CONTRACT QUESTION
None. Everything the screen needs is in `listQuoteRequests`, `changeQuoteRequestStatus` and `getCurrentWeeklyCount`.

## Findings (shared files outside my paths; I did not edit them)
1. **`src/components/ui/button.tsx`: the paused look has no `min-h-11`.** A paused "Move to" (Saving) is about 22 px high instead of 44 px (see `FE3-states/SCR-05--moving-desktop.png`); the mockup keeps 44 px. The same happens on the Requests tab rows. Suggested: add `min-h-11` to `pausedLook` (and `min-h-12` for primary paused). Owner: whoever owns `ui/button.tsx` (FE1/FE2 files).
2. **`src/components/ui/icon.tsx` has no `grip` or `move` icon** (the mockup has both). I drew them in `pipeline/pipeline-icons.tsx`; if they are added to the shared family, that file can go.
3. The grip is shown from 1280 px up only (as the mockup); below that a finger has no drag handle and uses Move to. A mouse can still drag a card at any width.

## Could not do / unverified
- **Env-prefixed build command** (refused), and **gzip first-load JS** (see above).
- **Not run on a Vercel preview** (no push by me).
- **Real-browser drag** (mouse and finger): pointer-event logic is tested with synthetic events and stubbed column rectangles in jsdom; the dragging look (copper outline, dashed target, "Release to move to ...") is not in any screenshot. **QA should drag a card with a mouse and with a finger on the preview, press Escape mid-drag, and release outside the columns.**
- **Auto-scroll while dragging** near the screen edge is not built (not in the design); on a short window use Move to.
- **Real Supabase token path** (as FE2): `useStaffRequest()` is passed on every call, tested only in mock mode.

## Notes for the next step
- `usePipeline().move` keeps a card where it was dropped until the columns have been fetched again; if that refetch fails the card stays where she put it (the server has it there).
- After a menu move focus is on the card's Move to button in its new column; after a refused move it returns to the card's Move to in the old column (a 409 puts focus on the banner, which holds Reload).
- Reminder from FE2: the old FE1 leftovers still to delete (no `rm` for me): `src/components/providers/app-providers.tsx`, `src/components/site/public-page.tsx`, `src/components/site/site-chrome.tsx`, `src/components/site/wordmark.tsx`.
