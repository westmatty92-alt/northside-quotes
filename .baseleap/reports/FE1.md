# STEP FE1: Public pages (SCR-01, SCR-02), fetcher, browser Supabase client

## Attempt 3: 2026-11-20
**Status:** partial. All code, tests and screenshots done; two of the seven verify commands could not be run in the exact form given (env-prefixed `npm run build`, see below). Nothing committed (no git, per the lane protocol).

**Refused command shapes (quoted, not worked around):**
- `NEXT_PUBLIC_API_MOCKING=on NEXT_PUBLIC_SUPABASE_URL=... npm run build` (with the `cd` prefix) -> "This Bash command contains multiple operations. The following part requires approval". The `env VAR=... npm run build` form and `node --env-file=<file> node_modules/next/dist/bin/next build` were refused the same way. I stopped after those and ran the plain forms instead. Also refused: `npm ls`, `gzip -k`, `node -e`, and `ls` with a pipe. Plain `ls <dir>`, `npm run ...`, `npx vitest`, `node scripts/...` work.
- So command 5 was run as plain `npm run build` (no env). Mocking and the dummy secret reached the app another way (below). **The ledger's exact command 5 is unverified by me.**

**Commands run:**
1. `npm ci` -> exit 0.
2. `npm run typecheck` -> exit 0.
3. `npm run lint` -> exit 0 (2 warnings, both in `scripts/`, not mine).
4. `npx vitest run src/components/request --passWithNoTests=false` -> exit 0, 4 files, 63 tests. Also `npx vitest run src/mocks` -> 2 files, 26 tests (`npm test`'s DB folders not run).
5. `npm run build` without env -> exit 0 (routes `/` and `/request-sent` are dynamic). With-env form: not runnable by me.
6. `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
7. `node scripts/verify-ui.mjs http://localhost:3201 --step FE1 --serve "npm run start -- -p 3201" --env APP_SIGNING_SECRET=... SCR-01=/ SCR-01--errors=... SCR-01--send-failed=... SCR-02=/request-sent?mockScenario=sent --allow-request "SCR-01--send-failed=/api/"` -> exit 0 ("no console errors, failed requests or axe violations"), **plus one extra flag I added: `--env NEXT_PUBLIC_API_MOCKING=on`**, because my build had no env. This works because `src/mocks/flag.ts` reads the variable on the server (the public pages' layout wrapper passes the result to the client), so one build runs with mocks on or off. Re-run by me after the last code change. With the ledger's build (flag set at build time) the value is inlined and the command needs no extra flag.

**Screenshots** (`/home/admin/baseleap/rehearsal/northside-quotes-wt-frontend/.baseleap/reports/FE1/`, plus `verify-ui.json`):

| Screen | Width | File | Matches mockup |
|---|---|---|---|
| SCR-01 (blank) | 390 / 1280 | `SCR-01-mobile.png`, `SCR-01-desktop.png` | Yes (mockup shows the filled state; mine is the blank state, same layout). |
| SCR-01 errors | 390 / 1280 | `SCR-01--errors-mobile.png`, `-desktop.png` | Yes: summary with 5 items, red fields and messages, 2 refused photos, offers box ticked. |
| SCR-01 send-failed | 390 / 1280 | `SCR-01--send-failed-mobile.png`, `-desktop.png` | Yes: failure banner, values and 3 photos kept, "Add a photo" paused with its message. The photo-2 upload error of the mockup is not on this screen (see notes). |
| SCR-02 | 390 / 1280 | `SCR-02-mobile.png`, `-desktop.png` | Yes. Differences: vertical rhythm about 2 to 4 px looser in places (line heights come from Tailwind's scale, not DESIGN.md's numbers). |

Console errors: 0. axe (WCAG 2.2 AA tags, phone width): 0 violations on all four. Component tests also run axe-core on each state (contrast and landmarks off in jsdom; verify-ui covers them).

**Performance:** Turbopack's build prints no per-route size. `/` loads 5 route chunks, about 507 kB raw (14 + 23 + 73 + 116 + 282 kB), plus the framework chunks. **Gzip size: unverified** (`gzip` was refused); the 170 kB gz budget needs a real measure, and I cannot rule out being near it (react-hook-form, supabase-js, zod 4 and TanStack Query are all in the form chunk). All mock code (msw, faker) is in dynamic chunks that load only when mocking is on.

**Tailwind utility names from theme.css, checked in the real build CSS:**
- Work by name: colours (`bg-teal`-style keys such as `bg-primary`, `text-text-inverse`, `border-border-strong`, `bg-surface-raised`), sizes (`text-h1`, `text-body-sm`, `text-ref-display`), tracking (`tracking-ref`), spacing (`p-md`, `gap-lg`, `size-sm`), radius (`rounded-md`), and the family names (`font-h1`, `font-ui-label`...).
- **Collision confirmed:** every `--font-X` family key has a same-named `--font-weight-X`, and Tailwind resolves `font-h1` to the FAMILY only. The weights are not reachable by name. I use `font-(weight:--font-weight-h1)` (variable form, still the token). The class strings are in `src/components/ui/typography.ts`.
- `tailwind-merge` mis-merges these names (`text-h1` vs `text-text-inverse`) unless told; `src/lib/utils.ts` now extends it with the DESIGN.md names.
- Line heights are not tokens in theme.css; Tailwind's `leading-tight` etc. are used (nearest to DESIGN.md's 1.05 to 1.55).
- **Finding (architect, `globals.css`):** Tailwind scans the whole repo, including `.claude/` skill docs, and emitted `.text-[#00D4A0]`, `.p-[13px]` and other junk rules into the production CSS. Suggest `@source not` for `.claude`, `.baseleap`, `docs`, `design`.

**Files created or changed:**
- `src/lib/api/fetcher.ts`: replaced the stub. Passes headers (X-Form-Token) through, throws `ApiProblem` (typed, with parsed problem+json, raw body, headers) on every non-2xx and `ApiNetworkError` on no answer.
- `src/lib/supabase/browser.ts`: sessionless upload client and cookie session client; env checked with Zod.
- `src/lib/utils.ts`: `cn` with tailwind-merge taught the theme names.
- `src/app/(public)/page.tsx`: SCR-01; `await connection()` before `issueFormToken()`.
- `src/app/(public)/request-sent/page.tsx`: SCR-02 (also `connection()`, so the CSP nonce can work).
- `src/components/request/`: `request-form.tsx`, `request-sent.tsx`, `photo-picker.tsx`, `urgency-choice.tsx`, `offers-checkbox.tsx`, `error-summary.tsx`, `job-tag.tsx`, `urgency-chip.tsx`, `use-photos.ts`, `submit-flow.ts`, `photo-upload.ts`, `form-values.ts`, `form-token.ts`, `session-store.ts`, `preview-context.ts`, `copy.ts`; tests `request-form.test.tsx`, `request-sent.test.tsx`, `submit-flow.test.ts`, `validation.test.ts`; helper `test-support.tsx`.
- `src/components/ui/`: `button.tsx`, `banner.tsx`, `field.tsx`, `icon.tsx`, `typography.ts`.
- `src/components/site/`: `site-chrome.tsx`, `wordmark.tsx`, `public-page.tsx`.
- `src/components/providers/app-providers.tsx`.
- `src/mocks/`: `flag.ts`, `scenarios.ts`, `previews.ts`, `handlers.ts`, `browser.ts`, `mock-provider.tsx`; tests `mocks.test.ts`, `fetcher.test.ts`.
- `.baseleap/reports/FE1.md`, `.baseleap/reports/FE1/*` (screenshots, `verify-ui.json`), `.baseleap/reports/FE1/verify.env` (stray file from a refused command, now just a comment; delete it).
- `.baseleap/tools/` was created by verify-ui (git-ignored Playwright and axe install).

**How the binding items are met:**
- Per-request render: layout wrapper `PublicPage` plus `connection()` in both pages; no static, ISR or "use cache".
- Tokens: token travels in `request.headers['X-Form-Token']` of both generated hooks. After a completed send: nonce into sessionStorage, `router.refresh()`, then SCR-02. On mount and `pageshow` a listed token refreshes first (forced on bfcache restore) and the offers box is unticked; a send with a listed token is not made (refresh plus the generic banner). On 409 `form_already_used`, 400 `form_expired` (and 401 `form_token_invalid`): refresh, banner, every value, photo and the offers tick kept. A 400 `submission_refused` does not refresh (a new token would be too young again).
- Offers box: native checkbox, `autoComplete="off"`, unticked on mount, sent as a JSON boolean; kept through every refusal (tests).
- Photos: up to 3, 5 MB, type read from the first bytes (JPEG, PNG, WebP), direct supabase-js upload with `upsert: false`, 409 treated as uploaded; refused files stay listed with the reason and block Send until removed; per-photo "Uploading n of m"; a failed upload shows beside its photo and a retry re-sends only that photo (same token and answers).
- SCR-02: receipt (reference, first name, phone, address, urgency, photo count) in sessionStorage, validated on read; reload keeps it; none -> `router.replace('/')`.
- Mock wiring: no service worker file exists in the lane and I may not write `public/` or a route for it, so mocks use msw's `defineNetwork` with a fetch interceptor (`src/mocks/browser.ts`). `?mockScenario=` (ok, errors, send-failed, rate-limited, form-expired, upload-failed, sent) is read only in `src/mocks/**`; the form gets its seed through `FormPreviewContext`, which nothing provides outside mock mode. `errors` and `send-failed` press Send once on load (`errors` makes no request; `send-failed` gets a 503 from `/api/`).

**Could not do / unverified:**
- Command 5 in its exact env-prefixed form; gzip first-load JS; the browser upload path against real Supabase Storage (component tests stand in for `uploadPhoto`; `isAlreadyUploaded` unit-tested; the live bucket policy is untested); the `upload-failed` scenario in a real browser (needs the Supabase env baked at build, which I could not set). It is covered in the component test and the mock handler test.
- Not run on a Vercel preview (no push by me).

**CONTRACT QUESTION:** none for the contract itself. Requests for the architect (dependencies and scaffold, no cost):
1. Declare `@mswjs/interceptors` in `package.json` (already installed as msw's dependency; `src/mocks/browser.ts` imports `@mswjs/interceptors/fetch`), and `axe-core` (installed through eslint-plugin-jsx-a11y; the tests import it). `@testing-library/user-event` and `@hookform/resolvers` are not installed; I used `fireEvent` and a small resolver in `form-values.ts`.
2. `src/app/globals.css`: `@source not` for `.claude`, `.baseleap`, `docs`, `design` (junk utilities above).
3. PERMISSIONS: I could not write `src/app/(public)/layout.tsx`, `src/lib/api/fetcher.test.ts` or a `public/` file. Chrome and providers therefore sit in `PublicPage`, used by each page. If a `(public)` layout is wanted, add it to the next step's owned files.

**Notes for the next step (FE2):**
- Add the staff bearer token and the 401 `session_expired` handling to `apiFetch`; reuse `ApiProblem`, `Banner`, `Field`, `Button`, `JobTag` (all three variants exist), `UrgencyChip`, `typography.ts`.
- The footer "Staff sign-in" link goes to `/sign-in` with `prefetch={false}` (prefetching a page that does not exist yet would be a failed request).
- Copy for messages the design does not give (name, address field errors; "Copied.") is mine, in `copy.ts`: please have the designer confirm.
- Behind-the-scenes choice to confirm: `react-hook-form` is used with a hand-written resolver over the generated Zod schema, plus a phone check mirroring the contract's written 10-digit rule.

## Pass 2: owned paths: 2026-11-20
**Status:** done. Four files moved under `src/components/ui/` so every FE1 file sits in an owned path. No git, no `rm`, so the old files could not be deleted; they are emptied and listed below for the orchestrator to remove.

**File moves** (content unchanged except the import paths):
| Old path | New path |
|---|---|
| `src/components/providers/app-providers.tsx` | `src/components/ui/app-providers.tsx` |
| `src/components/site/public-page.tsx` | `src/components/ui/site/public-page.tsx` |
| `src/components/site/site-chrome.tsx` | `src/components/ui/site/site-chrome.tsx` |
| `src/components/site/wordmark.tsx` | `src/components/ui/site/wordmark.tsx` |

**Imports updated:**
- `src/app/(public)/page.tsx` and `src/app/(public)/request-sent/page.tsx`: `PublicPage` from `@/components/ui/site/public-page`.
- `src/components/ui/site/public-page.tsx`: `AppProviders` from `@/components/ui/app-providers`, `SiteChrome` from `@/components/ui/site/site-chrome`.
- `src/components/ui/site/site-chrome.tsx`: `Wordmark` from `@/components/ui/site/wordmark`.
- A search of the lane's source, config and scripts found no other reference to the old paths.

**Leftover files for the orchestrator to delete** (each now holds only `export {};`, not zero bytes, because an empty `.tsx` file is not a module and I did not want to risk the `isolatedModules` typecheck; nothing imports them):
- `src/components/providers/app-providers.tsx`
- `src/components/site/public-page.tsx`
- `src/components/site/site-chrome.tsx`
- `src/components/site/wordmark.tsx`
- `.baseleap/reports/FE1/verify.env`: emptied to zero bytes (it only held a comment, no values).
The folders `src/components/providers/` and `src/components/site/` are left empty of real code and can be removed with the files.

**Commands run** (each with the `cd <lane> &&` prefix; one command per call, so exit codes are from each call finishing without an error):
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors, the same 2 warnings in `scripts/`, not mine).
- `npx vitest run src/components/request --passWithNoTests=false` -> exit 0, 4 files, 63 tests.
- `npm run build` -> exit 0; `/` and `/request-sent` still dynamic.
- `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
- `node scripts/verify-ui.mjs http://localhost:3201 --step FE1 --serve "npm run start -- -p 3201" --env NEXT_PUBLIC_API_MOCKING=on --env APP_SIGNING_SECRET=<dummy local value> SCR-01=/ SCR-01--errors=/?mockScenario=errors SCR-01--send-failed=/?mockScenario=send-failed SCR-02=/request-sent?mockScenario=sent --allow-request "SCR-01--send-failed=/api/"` -> exit 0 ("no console errors, failed requests or axe violations"; 8 views of 4 screens). Screenshots and `verify-ui.json` in `.baseleap/reports/FE1/` were regenerated. Local build, not a Vercel preview.

**Could not do:** delete files (no `rm`, no git); the notes under "Could not do / unverified" in Attempt 3 still stand (gzip size, Vercel preview).
**CONTRACT QUESTION:** none. The architect requests from Attempt 3 stand unchanged.

## Attempt 2: REV-2 CQ-4
**Status:** done, with two notes under "Could not do / unverified". Nothing committed (no git, per the lane protocol).

**The problem.** `uploadPhoto` treated any storage 409 as "already uploaded". After a failed send, a swapped-in photo with the same type and size (so an identical photo plan, same token, same request, same path) got a 409 from the old photo, was skipped, and the request was submitted with the old photo.

**Reproducing test, failing first.** `src/components/request/photo-swap.test.tsx`, test "a photo swapped in after a failed send (same type and size) is not treated as the one already uploaded". It runs the real form, send flow and `uploadPhoto` against a stand-in for the `quote-photos` bucket that answers 409 for an existing object (only `@/lib/supabase/browser` and `next/navigation` are replaced; the API is msw). Steps: send with photo X (uploads to photo-1), the submit fails (503), remove X, add Y (same type, same 2048 bytes), send again, storage answers 409.
Run against the unfixed code (`npx vitest run src/components/request/photo-swap.test.tsx`, exit 1):
```
× a photo swapped in after a failed send (same type and size) is not treated as the one already uploaded
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
  1st vi.fn() call: [ "/request-sent" ]
  ❯ photo-swap.test.tsx:156   expect(nav.push).not.toHaveBeenCalled();
Tests  1 failed | 1 passed (2)
```
That is the bug: the form went to SCR-02 and the old photo stood in for Y. (The second test in the file, the lost-reply retry of the same file, passed before and after: it pins the behaviour that must not change.)

**The fix.**
- `photo-upload.ts`: the uploader remembers, per path (the path carries the request id, so per token), which files this tab sent there (identity = name + size + lastModified, `photoIdentity`). A success makes the path exactly that file. An attempt that errors without a 409 (lost reply) may have landed, so its identity is kept as possible. On a 409 the photo counts as uploaded only if the one and only file this tab ever sent to that path is this file. Every other 409 (a different file, the same name and size with another lastModified, a path this tab never sent to, two different files that may both be stored) throws the new `PhotoConflict`. `isAlreadyUploaded` is kept, now documented as only "an object exists".
- `submit-flow.ts`: new `PhotoConflict` (defined here, not in `photo-upload.ts`, because `request-form.test.tsx` replaces that whole module). `runSubmission` lets a conflict outrank a plain upload failure and stops before submit; the conflicted photo's row is marked failed. `classifyFailure` maps `PhotoConflict` to the existing `fresh-token` kind.
- `request-form.tsx`: no new handling for the conflict, because `fresh-token` already does what CQ-4 asks: `router.refresh()`, every typed value, the photos and the offers box kept, the failure banner shown. The new token has a new nonce, so the next send is a fresh request, all photos are re-uploaded to new paths, and she taps Send again. One small addition in the same hazard class: a photo counts as `alreadyUploaded` only if it reached Storage at the position it now has (`uploadedAt` ref), so a photo that moves up after another is removed is checked at its new place instead of being skipped over a different photo sitting at that path.

**Passing.** Same command after the fix: `Test Files 6 passed (6), Tests 79 passed (79)` (the swap test now ends with: no navigation, `nav.refresh` once, typed values and offers tick kept, new token sent, Y stored at the new request's photo-1, token sequence `[TOKEN, TOKEN, TOKEN_2]`). I also removed the `uploadedAt` check temporarily and confirmed the "moves up" test fails without it, then restored it.

**New tests (all in `src/components/request/`):**
- `photo-swap.test.tsx` (3): the swap above; the moved-up photo; a same-file retry after a lost reply is still "already uploaded" (no new token, one submit).
- `photo-upload.test.ts` (11): identity, same file, same file after a lost reply, different file same type/size, same name/size with another lastModified, a path this tab never sent to, lost reply then a different file, a conflict repeated, a real landing after a lost reply, non-409 errors thrown as is.
- `submit-flow.test.ts`: conflict stops before submit and outranks a failed upload; `classifyFailure(PhotoConflict)` is `fresh-token`.

**Commands run (each as one `cd <lane> && ...`):**
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0 (0 errors; the same 2 warnings in `scripts/`, not mine).
- `npx vitest run src/components/request --passWithNoTests=false` -> exit 0, 6 files, 79 tests.
- Env-prefixed `npm run build` (`NEXT_PUBLIC_API_MOCKING=on NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... APP_SIGNING_SECRET=... npm run build`) -> **refused** ("This Bash command contains multiple operations. The following part requires approval"). Ran plain `npm run build` -> exit 0; `/` and `/request-sent` are dynamic. **The env-prefixed form is unverified by me.**
- `node scripts/check-code-guards.mjs generated` -> exit 0 ("OK").
- FE1's verify-ui command exactly as in the step entry (local `next start`, `--serve`, no mocking flag) -> exit 0 ("no console errors, failed requests or axe violations"). **Caution:** with my plain build, mocking is off, so every `mockScenario` URL rendered the blank form and `/request-sent` redirected to `/`; the screenshots were identical. That is a green that checked nothing about the scenario states. I re-ran it with `--env NEXT_PUBLIC_API_MOCKING=on` added (as in Attempt 3) -> exit 0, 8 views of 4 screens, 0 console errors, 0 failed requests, 0 axe violations; I looked at `SCR-01--send-failed-mobile.png` and it shows the failure banner, kept values and 3 photos. The screenshots in `.baseleap/reports/FE1/` are from that second run. With the ledger's build (flag set at build time) the extra flag is not needed.

**Files changed:**
- `src/components/request/photo-upload.ts`: identity record, 409 only for the same file, otherwise `PhotoConflict`.
- `src/components/request/submit-flow.ts`: `PhotoConflict`, conflict outranks upload failure, classified as `fresh-token`.
- `src/components/request/request-form.tsx`: header comment, `uploadedAt` position check.
- `src/components/request/photo-swap.test.tsx` (new), `src/components/request/photo-upload.test.ts` (new), `src/components/request/submit-flow.test.ts` (added cases).
- `.baseleap/reports/FE1.md` (this section) and regenerated `.baseleap/reports/FE1/*` screenshots and `verify-ui.json`.

**Could not do / unverified:**
- "Re-send": I used the existing refresh flow, where the page gets the new token and she taps Send again (the banner says so). An automatic re-send would have to wait for the new token to arrive through a re-render; I did not build that. Say if the reviewer wants it automatic.
- The photo row of a conflicted photo shows the existing "This photo didn't upload. Check your connection, then tap Send request to try again." copy (`copy.ts`). It is not wrong, but "check your connection" is not the cause; designer to confirm or supply copy.
- Identity is name + size + lastModified (as CQ-4 allows), not a content hash. Two different files with all three equal would be treated as the same file; I judged that not realistic and did not hash 5 MB files on a phone.
- Not run against real Supabase Storage (the bucket is a stand-in answering 409 like `upsert: false` does) and not on a Vercel preview (no push by me). The component tests use jsdom.
- Backend's photo-plan comparison is not exercised here; this change is independent of it.

**CONTRACT QUESTION:** none. **BLOCKED:** none.
