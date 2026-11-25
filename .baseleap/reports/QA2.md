# STEP QA2: Permission probes, API boundary checks and a Schemathesis fuzz run on the staging preview

## Attempt 1: 2026-11-24 (evening local, 2026-11-25 UTC)

**Status:** partial. The probes are written and ran: **50 of 54 pass, 4 fail on 3 real bugs, no permission boundary crossed.** The **fuzz run could not run here** (nothing can be installed and `bash tests/fuzz/run.sh` is refused), so there is no fuzz count and the "no 5xx and no contract break in the fuzz run" criterion is **not proven**.

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app, commit `42208a49aaaf21477fd369360f6a17caed80254f` (`42208a4`, read from `/api/health`).

**Read:** `docs/SECURITY_MODEL.md`, `docs/threat-model.md`, `docs/openapi.yaml`, `docs/test-plan.md` (permission rows, boundaries), `docs/user-stories.md` (AC-001.17, AC-002.8, AC-003.x, AC-004.x), `docs/metrics-spec.md` (the `spam_submission_blocked` event), `.baseleap/reports/QA1.md`, QA1's support files in `tests/e2e/support/`, the migrations' function and policy signatures (`supabase/migrations/*.sql`, only to aim probes at the right names) and the generated Zod schemas in `src/lib/api/generated/` (response shapes). I did not read application code under `src/app` or `src/lib/server` and did not open `.env.local`.

## Results per area (detail in `docs/qa-reports/QA2-run.md`)

| Area | Result |
|---|---|
| No session, forged tokens, cookie without bearer (63 + 21 + 6 requests) | pass |
| Unknown ids, malformed ids, unlisted methods, method override | pass |
| Mass assignment on create (422 naming all ten fields) and on both staff writes | pass |
| Direct Supabase with the anon key: 10 tables read and write, 16 functions, private schemas, Auth settings | pass |
| Direct Supabase with owner and helper tokens: reads allowed only on 6 tables, no writes, no service functions, token dead after sign-out | pass |
| Storage: folder escape, 4th photo, overwrite, delete, copy, move, list, every read of an unsubmitted photo, bad files, signed URLs | pass |
| 20 parallel creates: exactly 5 accepted, 15 refused with `Retry-After`; 30 honeypot refusals: one event, count 30 | pass |
| AC-001.17 consent coercion (maybe, text true, 1, null, [], {}) | pass |
| Throwaway email: attempts 6 to 20 are 429 with no `Retry-After`; `next` never leaves the site | pass |
| Job routes with `Bearer undefined`, empty, missing, wrong, borrowed (28 + spoofed headers) | pass |
| Stored script text on list, board and detail, phone and desktop | pass |
| Headers, no CORS, no secrets in any shipped script | pass |
| Contract conformance of 25 GET responses and the problem bodies (not Schemathesis) | pass |
| Create-route input: valid edges accepted, 38 invalid inputs 422 | **fail**: unpaired surrogate gives 500 (BUG-QA2-2) |
| Unknown and password routes answer 404 | **fail**: 200 HTML for non-GET and for GET with Authorization (BUG-QA2-1) |
| Sign-in body type | **fail**: `text/plain` accepted (BUG-QA2-3) |
| **Fuzz** | **NOT RUN** |

## Fuzz counts

**None.** Schemathesis is not installed and could not be installed or run in this session. Exact refusals, each "This command requires approval": `python3 -m venv .baseleap/tools/venv-schemathesis`, `pipx run --spec schemathesis schemathesis --version`, `docker run --rm schemathesis/schemathesis:latest --version`, `python3 -m pip --version`, and `bash tests/fuzz/run.sh`. No `uv` or `uvx` on the machine. `tests/fuzz/run.sh` therefore exits 3 ("NOT RUN ... This is not a pass") wherever Schemathesis is absent, and runs the three Schemathesis runs where it is present. To close this gap: have someone approve `python3 -m venv .baseleap/tools/schemathesis-venv && .baseleap/tools/schemathesis-venv/bin/pip install "schemathesis>=4,<5"` (inside the repo, git-ignored), or run with `SCHEMATHESIS_ALLOW_INSTALL=1` where `uvx` or `pipx` may fetch it. The Schemathesis flags are from its version 4 documentation and were never executed, so expect one correction round.

In place of the fuzz run's response-shape and negative-input checks, the probes cover, from outside and without Schemathesis: 25 responses against the generated schemas with an undocumented-field check (the checker is itself tested), 38 invalid create inputs, 25 invalid staff-write bodies, 15 bad list parameters, 13 filter-looking search strings, malformed JSON bodies and explicit `null` for the optional fields. They are not generated inputs and do not replace the fuzz run.

## Tickets (`.baseleap/reports/QA2-errors.md`)

| Ticket | Severity | Owner | Class |
|---|---|---|---|
| BUG-QA2-1 unknown paths answer 200 HTML for POST, PUT, DELETE and GET with Authorization (incl. password and reset paths) | Important | bl-backend (bl-frontend if the not-found page or proxy is theirs) | server |
| BUG-QA2-2 `POST /api/quote-requests` 500 on an unpaired surrogate in name, problem or address | Important | bl-backend | server |
| BUG-QA2-3 sign-in accepts `Content-Type: text/plain` | Minor | bl-backend, bl-security to rate | server |

No Critical ticket. No flaky test (retries are off for the probes project).

## Files changed (all inside the step's files, plus one config project and the report files)

- `tests/e2e/probes/support.ts`: shared helpers (staging-only guard for Supabase, staff tokens through Supabase Auth, redaction-safe line helpers, the spam-event reader, the submission-window reservation, run state file, contract checker)
- `tests/e2e/probes/10-anonymous-routes.probe.spec.ts`, `20-jobs.probe.spec.ts`, `30-supabase-rest.probe.spec.ts`, `40-public-form.probe.spec.ts`, `50-staff-writes.probe.spec.ts`, `60-sign-in.probe.spec.ts`, `65-contract.probe.spec.ts`, `70-headers-and-bundles.probe.spec.ts`, `80-storage-and-create.probe.spec.ts`: 54 tests, every title tagged `@probe`
- `tests/e2e/probes/created.ndjson`: the requests the probes created (generated)
- `tests/fuzz/run.sh`, `tests/fuzz/run.mjs`: the Schemathesis run (untried)
- `playwright.config.ts`: **one new project, `probes`** (`testMatch` the `probes/` folder, no dependency on `setup`, retries 0). Needed so `playwright test tests/e2e/probes` finds the tests, and so the run does not trigger QA1's `setup`, which empties `qa-e2e-created.ndjson`. Nothing else in the file changed. This file is outside the step's listed files; it is a QA-owned file, flagged here.
- `docs/qa-reports/QA2-run.md`, `docs/qa-reports/playwright-results.json` and `playwright-report/` (generated by the full run: the JSON replaces the earlier QA1 and visual run's file of the same name)
- `.baseleap/reports/QA2.md` (this file), `.baseleap/reports/QA2-errors.md`

Not edited: `docs/test-plan.md` (it names `tests/e2e/api/permissions.spec.ts` for the permission rows; they are in `tests/e2e/probes/`), QA1's specs and support files, product code.

## Commands run

- `npx playwright test tests/e2e/probes` (full, default reporters, 52 tests) → exit 1, 48 passed, 4 failed (PRB-06, PRB-06b, PRB-08, PRB-74b), 0 flaky, 19.2 min
- `npx playwright test tests/e2e/probes/10-anonymous -g PRB-00 --reporter=json` → exit 0, commit `42208a49aaaf...`, status ok
- `npx playwright test tests/e2e/probes/50-staff -g PRB-44 --reporter=line` → exit 0
- `npx playwright test tests/e2e/probes/80-storage -g PRB-75 --reporter=json` → exit 0, create with ten extra fields: 422 `validation_failed` naming all ten
- `npx playwright test tests/e2e/probes --list --project=probes` → 53 tests listed (54 with PRB-44, added afterwards)
- `grep -q 'vercel.app' docs/qa-reports/QA2-run.md` → exit 0
- `npx tsc --noEmit` → exit 0; `npx eslint tests/e2e/probes tests/fuzz playwright.config.ts` → exit 0, no output
- `node --env-file=.env.local node_modules/.bin/playwright test tests/e2e/probes --list` → **refused** ("This command requires approval", as in QA1); `npx playwright test tests/e2e/probes` is the same suite
- `bash tests/fuzz/run.sh` → **refused** ("This command requires approval"); not run

## Could not do

- The Schemathesis fuzz run (above): not installable here, `run.sh` refused. Not faked.
- The ledger's `node --env-file=.env.local ...` form of the probes command (refused).
- AC-004.11 (per-address limit): deliberately not driven, because 20 failures would pause this machine's address for 15 minutes for every agent on the shared preview.
- AC-004.5 with the real owner account, and the same-message check against a real account: not run (Matthew's rule: no failed sign-ins for the owner or helper).
- Cron routes with the correct secret (QA has no `CRON_SECRET`); AC-004.13 and AC-003.5 (counters unreadable); AC-003.8 (1,000 events); seven-day expiry; IPv6 /64 keying; live GHL.

**CONTRACT QUESTION:** none for the product. One for the plan owner (QA): `docs/test-plan.md` lists the permission rows under `tests/e2e/api/permissions.spec.ts`; they are now in `tests/e2e/probes/`.
**BLOCKED:** the fuzz run needs someone to approve installing Schemathesis inside the repo (or `uvx` / `pipx run`, pinned to major version 4), or to allow `bash tests/fuzz/run.sh`. No variable is missing.

## Notes for the next step

- **The ledger's verify lines will not all pass.** `grep 'vercel.app'` passes. `npx playwright test tests/e2e/probes` exits 1 until BUG-QA2-1, -2 and -3 are fixed (the 4 failing tests are the regression tests; I did not weaken or skip them). `bash tests/fuzz/run.sh` exits 3 until Schemathesis is available.
- **A full probe run takes about 20 minutes** and creates 7 visible requests plus 1 pending one (all `QA-PROBE <run id>`), spends the 5-per-10-minutes submission window twice (the ledger file `playwright/.cache/submission-slots.json` makes the second wait), and adds 5 failed sign-ins for a throwaway email to this address's 20-per-15-minutes count. Do not run it twice inside 15 minutes, do not run it from two machines at once, and do not run it while QA1's suite runs (they share the submission window and the staff accounts).
- QA1's `tests/e2e/support`-based `platform.both.spec.ts` still expects commit `0dff609`; staging is `42208a4`.
- After the three fixes, reopen QA2 and run `npx playwright test tests/e2e/probes`; the 4 failing tests should pass with nothing else changing. REV1 and SEC1 can start from this report (no Critical, three tickets, fuzz not run).
- Baseleap removes the `QA-PROBE` requests by name prefix (14 visible, 2 pending); the full list with references is in `docs/qa-reports/QA2-run.md`.
