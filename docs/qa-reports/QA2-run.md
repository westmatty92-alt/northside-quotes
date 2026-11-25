# QA2 run report: permission probes, API boundaries and fuzz on the staging preview

**Verdict at `bb54c17`: the probes PASS (54 of 54), all three earlier bugs are fixed, no permission boundary was crossed, no new defect. The Schemathesis fuzz run has NOT run yet, so the step is not complete: there is no fuzz result and no fuzz pass.** The fuzz script is changed and ready; it is unverified until the ledger's verify (outside this session's approval prompts) executes it.

**Target:** https://northside-quotes-git-staging-baseleap.vercel.app (the Vercel preview of `staging`) · **Commit under test:** `bb54c17d2ea4d9d873f2f9f77d0af70dbcce2875` (`bb54c17`, read from `/api/health` by `PRB-00`, status `ok`) · **Step:** QA2, re-run after the backend fixes · **Date:** 2026-11-24 evening local (2026-11-25 UTC) · **Run type:** full probe run, once, then one probe run alone.

**Preflight:** the first `/api/health` read, at the start of the session, still reported `42208a4` (the build had not landed). The second read, about 2 minutes later (02:30 and 02:32 UTC; this session cannot sleep, so the retry was the next command), reported `bb54c17d2ea4...`. The full run started after that.

**Command:** `npx playwright test tests/e2e/probes` (project `probes`, retries 0, run id `ida17`) → exit 0, **54 passed, 0 failed, 0 flaky, 0 skipped, 12.3 minutes**. Evidence: `docs/qa-reports/playwright-results.json` (stats: 54 expected, 0 unexpected, 0 flaky; it replaces the first run's file of the same name) and `playwright-report/`. The ledger's own form, `node --env-file=.env.local node_modules/.bin/playwright ...`, is refused in this session ("This command requires approval"); `playwright.config.ts` loads `.env.local` itself, so the command above runs the same tests.

## The three earlier tickets

| Ticket | Result at `bb54c17` | Evidence (re-runnable) |
|---|---|---|
| **BUG-QA2-1** unknown paths answered 200 HTML | **RESOLVED** | `PRB-06b` passes: `/api/does-not-exist`, `/api/auth/does-not-exist` and `/does-not-exist`, each with 9 variants (GET plain, GET with `Authorization`, GET with `Accept: application/json`, GET with a cookie, HEAD, POST with and without a body, PUT, DELETE) all answer 404. `PRB-06` passes: 17 password, reset, recover, sign-up and magic-link style API paths x GET, POST, PUT x (no session, staff token) = 102 requests all 404, and 9 pages 404. (The test file is unchanged since the failing run.) |
| **BUG-QA2-2** 500 on an unpaired surrogate in `name`, `problem` or `address` | **RESOLVED** | `PRB-74b` passes, and I **tightened** it first: the four surrogate cases (name on an update of a pending request; name, problem and address on a new request) now each require **422, `application/problem+json`, and the field named in `errors[]`**, not just "not a 5xx". Run in the full run and again alone: pass. NUL characters, SQL text, filter text, explicit `null`, a 1.5 MB padding field and the 4 malformed bodies still pass. |
| **BUG-QA2-3** sign-in accepted `Content-Type: text/plain` | **RESOLVED** (under the ruling) | `PRB-08` passes. Per the ruling the expected status is now **400 with code `bad_request`** (the contract has no 415) for `text/plain` and, added, for `application/x-www-form-urlencoded`: the body is not treated as a sign-in (never 401 `invalid_credentials`, which would count a failed attempt). The 4 JSON malformed-body cases are unchanged. |

**The PRB-08 change is a contract ruling, not a weakening:** the test still fails on a 401, a 429, a 2xx, a 5xx, a non-problem body, a cookie or a leak; it now names the one status it accepts. If the architect adds a 415 to the contract (their open soft question), this one line changes with it.

No new defect was found, so there is no new ticket (`.baseleap/reports/QA2-errors.md` records the three as resolved).

## Counts

| | Tests | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|---|
| Full run `ida17` at `bb54c17` | 54 | 54 | 0 | 0 | 0 |
| `PRB-74b` run alone afterwards (run id `itzkc`, the tightened version) | 1 | 1 | 0 | 0 | 0 |

Retries are off for the `probes` project, so nothing can be "flaky": a failure is a failure. No test was skipped, quarantined or weakened. The first run (at `42208a4`) was 50 of 54 with these 3 bugs; nothing else changed in the probes between the two runs except the two edits above.

## Results per probe area (all re-run on `bb54c17`)

| Area | Probes | Result | What was proven |
|---|---|---|---|
| **No session, 401** | PRB-01, 02, 03 | pass | All 9 staff routes with 7 kinds of missing or useless credential (63 requests): 401 `problem+json`, documented code, no cookie, no database text. Forged tokens refused (some by Vercel's own edge with a plain 403, see Notes). A session cookie without the bearer is refused on every route. Owner and helper tokens work (positive controls) |
| **Unknown ids, methods** | PRB-04, 05 | pass | Unknown ids 404 `not_found`; malformed ids never 5xx and leak nothing; 16 unlisted methods and 3 override headers answer 405 `method_not_allowed` with `Allow`; a request can never be deleted |
| **Unknown and password routes (was BUG-QA2-1)** | PRB-06, 06b | pass | See the table above |
| **Staff pages signed out** | PRB-07 | pass | Redirect to `/sign-in?next=` with no request data |
| **Sign-in body type (was BUG-QA2-3)** | PRB-08 | pass | See the table above |
| **Job routes** | PRB-10, 11 | pass | 28 credential variants plus spoofed cron headers, query-string secrets and other methods: all 401 (or 405). The correct-secret path is not exercised (QA has no `CRON_SECRET`) |
| **Direct Supabase** (anon, owner, helper) | PRB-20 to 28 | pass | Anon key reads and writes no table; 16 functions refused; private schemas not exposed; sign-up and anonymous sign-in off; staff tokens read only the six allowed tables, write none; a token dies when its session is signed out; the Supabase URL probed is the app's |
| **Public form abuse controls** | PRB-30 to 34 | pass | 30 honeypot refusals alike with one event of count 30; token under 3 s, missing, forged: refused; **20 parallel creates: 5 accepted, 15 refused 429 with `Retry-After`**, 5 stored; consent coercion (AC-001.17); a token cannot complete another request |
| **Staff write boundaries** | PRB-40 to 44 | pass | Extra fields refused or ignored; 17 invalid `PUT quote` bodies, 8 invalid status changes, stale versions 409, explicit `null` accepted where optional; copy retry on an unticked request 409; surrogates in the staff note and search handled |
| **Stored script text** | PRB-43 | pass | Shown as text on list, board and detail, phone and desktop; `window.__xss` undefined |
| **Sign-in limits** | PRB-50 to 52 | pass | Throwaway email: attempts 1 to 5 are 401, 6 to 20 are 429 `sign_in_paused` with no `Retry-After`; the owner still signs in; `next` never leaves the site |
| **Contract conformance (not Schemathesis)** | PRB-63, 64, 66, 67, 68 | pass | 25 GET responses against the generated schemas with no undocumented field (the checker is itself tested); problem bodies; 15 bad list parameters; filter-looking search text; personal data is `no-store` or `private` |
| **Headers, CORS, bundles** | PRB-60 to 62 | pass | Nonce CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no CORS anywhere, no secret in any shipped script |
| **Storage** | PRB-70 to 73 | pass | Own pending folder only, 3 photos at most, no overwrite, delete, copy, move or list; every read of an unsubmitted photo fails; bad files refused; after submit, 900-second signed URLs only |
| **Create-route input** | PRB-74, 74b, 75, 76 | pass | Every valid edge accepted; 38 invalid inputs 422 naming the field; **4 unpaired-surrogate cases 422 naming the field**; mass assignment with ten extra fields 422 naming all ten; only the run's own requests left visible |

## Permission matrix (docs/SECURITY_MODEL.md) against probes

All rows pass at `bb54c17`, including the one that failed on the status code at `42208a4`: **Passwords: no change or reset route** (PRB-06, 06b, 26) now answers 404 everywhere. Rows: `quote_requests` (anonymous creates a pending request only through the API; staff read submitted rows only and write only through the RPCs), `quote_photos` and the `quote-photos` bucket, status changes, GHL sync jobs, events, staff, the four counter tables, staff routes with no or a non-staff session, form-token routes, sign-in limit, job routes, health. **No boundary was crossed; no Critical finding.**

## Fuzz (Schemathesis): setup changed, NOT RUN, no counts

Per the ruling (ledger 2026-11-24), `tests/fuzz/run.sh` now installs Schemathesis itself when it is missing:

- **Pinned version: `schemathesis==4.0.0`** (the 4.0 release; the lowest 4.x, chosen because I am certain it exists and has the v4 command line the flags were written for. I could not look up newer ones: `pip index` is refused here. Raising the pin is one line, `SCHEMATHESIS_VERSION` at the top of `run.sh`, and should be noted here when done).
- **Where:** `python3 -m venv .baseleap/tools/venv` (git-ignored: `.baseleap/tools/` is in `.gitignore`), then `.baseleap/tools/venv/bin/python -m pip install schemathesis==4.0.0`. Nothing outside the venv is touched. If the venv holds a different version it is replaced by the pinned one. `schemathesis` on `PATH`, `uvx` and `pipx` are no longer used, so every run uses the same version.
- **Prints** the installed version before the run (`Schemathesis installed version: 4.0.0 (pinned 4.0.0)`), and the version is the first line of `tests/fuzz/last-run.txt`.
- **Exit codes:** 0 no finding; 1 findings (a 5xx, a response that breaks the contract, an undocumented status: any Schemathesis failure); 2 a setup problem (missing variable name, refused host, no token) **or a Schemathesis run that did not complete or tested nothing** (a usage error from a wrong flag, a crash, zero test cases: none of these can read as a pass); **3 "NOT RUN"** when `python3 -m venv` or `pip install` fails, or the installed version is not the pinned one. A failed install is never a pass.
- **Gentle:** three runs. `anonymous` and `staff` (the owner's token, got once from Supabase Auth like a browser does): 20 examples per operation (`--max-examples 20`), one worker, 5 requests a second, phases `examples,coverage,fuzzing`, no stateful phase, `/auth`, `/storage` and `/jobs` excluded (sign-in is excluded because fuzzed emails would count as failed sign-ins for this machine's address). `jobs`: **only the two cron routes, one generated case each, sent with no secret: the documented 401**, nothing else. The bypass header goes to the staging host only (a host check refuses anything that is not `<project>-git-staging-<team>.vercel.app`, and anything on `PRODUCTION_HOSTS`). Every secret value is replaced by its variable name in the output.
- **Checked by reading** (this session cannot run `bash -n`, `python3 -m venv`, or `pip`; each was refused with "This command requires approval"): the bash syntax and quoting of `run.sh`, the node syntax of `run.mjs` (`npx eslint tests/fuzz` passes, `npx tsc --noEmit` passes). **Unverified:** that the venv installs on this machine (`python3` is 3.12.3; on Debian or Ubuntu the `python3-venv` package must be present, otherwise the script exits 3 and says so), that version 4.0.0 resolves, and that every Schemathesis flag is accepted by it (`--url`, `--header`, `--checks all`, `--rate-limit`, `--workers`, `--no-color`, `--phases`, `--max-examples`, `--exclude-path-regex`, `--include-path-regex`, `--report junit`, `--report-dir`). The flags come from the v4 documentation and were never executed. Expect one correction round on the first real run, and some first-run noise from `--checks all` (for example a positive-data check on the public create route, where a random form token is a documented 401).

## Test data left on staging

Requests cannot be deleted through the app (NG-7). Baseleap removes them by name prefix `QA-PROBE`. Names carry script text on purpose. Nothing was sent to GoHighLevel (every request has offers consent no).

| Run id | Visible to staff | Pending only (never submitted, purged by housekeeping after 24 hours) |
|---|---|---|
| `ida17` (the full run above) | NQ-DWUSJY, NQ-79YWMB, NQ-5BU5NM, NQ-GXXSKH, NQ-GVNEYM (the burst); NQ-NV5AKT (A), NQ-4SGXNZ (B) | 1 boundary request |
| `itzkc` (`PRB-74b` alone) | none | 1 boundary request (not listed in `created.ndjson`) |

The earlier runs' requests (run ids `ga07q`, `gbfld`, `gqutp`: 14 visible, 2 pending) are listed in `tests/e2e/probes/created.ndjson`. Total now: **21 visible, 4 pending**, all `QA-PROBE <run id>`.

Other traces on the shared staging project: `spam_submission_blocked` events (one window each per run); 5 failed sign-ins for a throwaway address of the form `qa-probe-<run id>-lock@example.test` per run (no account, purged after 24 hours), plus the `PRB-08` malformed-sign-in cases (none of them counts as a sign-in now); the owner and helper were used only for successful sign-ins; no real staff email was used for a failed sign-in.

## Not run, or not proven (unverified)

- **The Schemathesis fuzz run: no result at all.** See above.
- **Per-address sign-in limit (AC-004.11):** not driven (20 failures would pause this address for 15 minutes for every agent on the shared preview).
- **AC-004.5 with the real account** and AC-004.12's "same message for a real account": not run (no failed sign-ins for the owner or helper). Unknown email only.
- **AC-004.13 and AC-003.5** (counters unreadable): cannot be induced from outside. **AC-003.8** (1,000 events a day): not run.
- **The cron routes with the correct secret:** QA holds no `CRON_SECRET`.
- **Seven-day session expiry**, **IPv6 /64 keying** (IPv4 behaviour only), **embed handoff** (no embedded screen, NG-11), **live GoHighLevel** (no request had consent).
- Whether Vercel's edge refusals (Notes) are a project setting or a platform default.

## Notes

- Vercel's own edge refuses some hostile requests before the app runs: a JWT whose header says `alg: none` (plain 403) and a NUL byte in a path (plain 400). The boundary holds; the answer is not the contract's `problem+json` 401. The probes accept exactly that form and count it.
- `playwright.config.ts` has one QA-added project, `probes` (no dependency on `setup`, retries 0).
- `docs/test-plan.md` still names `tests/e2e/api/permissions.spec.ts` for the permission rows; they are in `tests/e2e/probes/*.probe.spec.ts` (not edited: outside this step's files).
- QA1's `platform.both.spec.ts` still expects commit `0dff609`; staging is `bb54c17` (QA1's file, not touched).
- A full probe run takes about 12 to 20 minutes: after the 20-parallel burst uses the whole 10-minute submission window, the storage probes wait for it to age out. Do not run two probe runs within 15 minutes, from two machines, or while QA1's suite runs.
