# Security Review · SEC1

**Verdict: BLOCKED** — 0 Critical · 1 Important · 5 Minor open
**Reviewer:** bl-security · **Diff:** `origin/main..origin/staging` = `38460b3..4b20835` (695 files, +65,300 −1,247) · **Round:** 1 · **Date:** 2026-11-25
**Staging URL:** https://northside-quotes-git-staging-baseleap.vercel.app · **Commit reviewed:** `4b20835d4d57910d9ef3cb3c69e35ea6de292e1b` (staging head; the tree is identical to `lane/backend` `979c8ca`, confirmed with `git diff --stat 979c8ca 4b20835`, which returned nothing)
**Companion:** `docs/threat-model.md` (S0). The diff adds no new trust boundary to it. The proxy's 404 handling and the sign-in content-type check strengthen boundaries that are already listed.

**In one paragraph.** The application itself is in good shape. Every `/api` route authenticates and authorises, and all ten tables have RLS enabled **and** forced. The service role is imported by exactly the five modules invariant 2 names. The CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY` are set as specified. Logs pass through field allow-lists. I found no secret in the history of the range. The one blocking item is in QA's fuzz tooling, not in the shipped app: `tests/fuzz/run.sh` installs Schemathesis with ~54 floating, unhashed transitive PyPI packages. `run.mjs` then runs them with the whole of `.env.local` in their environment (SEC-25, Important). It does not ship to production, so Matthew may rule it acceptable at Gate 3 (`stack-gatekeep` §4). The fix is about an hour of QA work. Of the S0 Minors, SEC-23 is closed; SEC-21, SEC-22 and SEC-24 are confirmed still open and stay non-blocking.

**Scanners did not run** (all refused by the session permission system; see Tool results). Every check below comes from reading code and SQL at `4b20835`, plus `git log -G` pattern searches. No scan is reported as passed.

## Findings (Critical first)

### SEC-25 · Important · Likely — The fuzz installer runs ~54 unpinned, unhashed PyPI packages with every `.env.local` secret in their environment
| | |
|---|---|
| **Where** | `tests/fuzz/run.sh:36` (`pip install --no-input --disable-pip-version-check "schemathesis==$SCHEMATHESIS_VERSION"`: one exact pin, no `--require-hashes`, no lock or constraints file, sdists allowed) · `tests/fuzz/run.mjs:66` (`process.loadEnvFile('.env.local')` loads the whole file) · `tests/fuzz/run.mjs:216` (`spawn(cmd, args, { env: { ...process.env, NO_COLOR: '1' } })` hands all of it to Schemathesis) · `tests/fuzz/run.mjs:165, 177` (the Vercel bypass secret and the owner's access token passed as command-line `--header` arguments) |
| **Breaks** | sec-supply-chain §1: "Dev-only dependency (build/test tooling): Minor unless it runs … with secrets". This one runs with secrets. It also breaks the S0 "Pre-existing" concern about secrets near agents (sec-ai §2, "Secrets near agents"). |
| **What's wrong** | The brief asked me to rate the install line. **On its own it is low risk:** an exact top-level pin, PyPI over HTTPS, inside a git-ignored venv, reinstalled only when the version differs. **The risk comes from what runs it.** Pip resolved 55 distributions into `.baseleap/tools/venv` (listed from `site-packages`). 54 of them float (for example `harfile`, `pyrate_limiter`, `hypothesis_graphql`, `backoff`, `rpds_py`, `starlette_testclient`), and several of those are small, single-maintainer projects. None is hash-checked, and their versions are recorded nowhere in the repo. Every one is imported into a process whose environment is the whole of `.env.local`. By `.env.example` that file holds `BASELEAP_LEDGER_SERVICE_KEY` (the Baseleap Console, which spans clients), `SUPABASE_STAGING_DB_URL` (password inline), `SUPABASE_STAGING_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET` and the QA passwords. The fuzz needs none of these in Schemathesis's environment: it gets its token and bypass header as arguments. Secondary points: arguments are readable through `/proc/<pid>/cmdline` by other users on the machine. The HAR reports written to `.baseleap/tools/fuzz-reports/` (`run.mjs:213`, `--report junit,har`) record request headers, so the bypass secret and the staff token sit there in plain text (HAR records headers by format; I did not open the files, to avoid reading a secret). |
| **Scenario** | A compromised or newly malicious release of any transitive dependency, published before the venv is next rebuilt (a pin bump, a fresh machine, CI), runs at import time. It sends the ledger service key, the staging database URL and the service-role keys from its environment to the attacker. |
| **Fix direction** | (1) `run.mjs:216`: spawn with a minimal environment, `{ PATH, HOME, LANG, NO_COLOR: '1' }`, never `...process.env`. (2) `run.mjs:66`: read only the eight names the script uses from `.env.local`, not the whole file into `process.env`. (3) Add `tests/fuzz/requirements.lock`, generated once for Python 3.12 with `pip-compile --generate-hashes` (or `uv pip compile --generate-hashes`) from `schemathesis==4.0.0`. In `run.sh:36`, install with `pip install --require-hashes --only-binary=:all: --no-deps -r tests/fuzz/requirements.lock`, and make the version check also compare the lock's hash. (4) Pass the bypass header and token through a `0600` temp config file, or Schemathesis's environment-variable header support if 4.0.0 has it (unverified), instead of `argv`. Delete the HAR files after `serverErrors()` has read them, or redact their headers. Regression check for QA: a fake `schemathesis` binary in a test that prints its own environment must show none of the `.env.local` names. |
| **Owner hint** | qa (`tests/fuzz/**`); devops for the CI side, if the fuzz is ever moved into a workflow |
| **Signature** | `supply-chain: fuzz venv installs unhashed transitive deps and inherits full .env.local` |

### SEC-21 · Minor · Confirmed (S0, still open) — Rate-counter errors are still swallowed with no signal
| | |
|---|---|
| **Where** | `supabase/migrations/20261120000600_functions.sql:138-142` (`exception when others then v_slot := true`); `src/lib/server/services/submissions.ts:142-152` (`StartOutcome` has no "counter unavailable" flag, and nothing is logged) |
| **Breaks** | Weakens invariant 16 in practice. AC-003.5 is met: the counter failing open is by design. |
| **What's wrong** | Unchanged since S0 round 2. A lasting counter fault (a bad hash format, a missing grant) switches off the 5-per-10-minutes limit with no log line and no metric. **Today it works:** QA2's PRB-32 on the preview accepted 5 of 20 parallel creates and refused 15 with 429. So this is about losing the alarm, not the limit. |
| **Scenario** | A later change encodes the address hash differently. Every insert into `rate_limit_hits` fails its check constraint, every create is accepted, and the storage-fill attack (S0 SEC-3) is open again while every test stays green. |
| **Fix direction** | As filed in S0: `start_quote_request` returns `'rate_limit', 'unavailable'` from the handler. `startQuoteRequest` logs `{ outcome: 'created', error_class: 'rate_limit_unavailable' }` (never the hash). Add a function test with a malformed hash that expects `created` plus the flag. Keep PRB-32 as a release check. |
| **Owner hint** | architect (SQL, additive migration), backend (log line) |
| **Signature** | `rate-limit: counter errors swallowed without signal` |

### SEC-22 · Minor · Confirmed (S0, still open) — An unverified email-or-phone match lets a stranger's request share a real homeowner's GHL contact
| | |
|---|---|
| **Where** | `supabase/migrations/20261120000600_functions.sql:809` (`lower(btrim(m.email)) = lower(btrim(r.email)) or m.phone = r.phone`), `:837` (last change wins); `src/lib/server/integrations/ghl/process-job.ts:80-85` (our match, then GHL's duplicate search, both link to whatever they find); `docs/SECURITY_MODEL.md:134` and `docs/integration-contract.md:102-107` carry none of the S0 fix-direction lines |
| **Breaks** | Integrity of a third party's CRM record (threat-model asset "Integrity of the record"). Nothing written down is broken. |
| **What's wrong** | The code is unchanged, and the documentation half of the S0 fix was not done: there is no accepted-risk line for the two cases, no handoff rule against stage-specific texts, and no runbook line for unlinking. Nothing reaches the submitter through our app: the copy runs in `after()`, and linking sends tags only. |
| **Scenario** | Someone submits a ticked request with Ms A's phone. It links to her contact, and when staff mark the spam request Lost, her Won contact gets `quote-lost`. |
| **Fix direction** | As filed in S0: add the accepted-risk line in SECURITY_MODEL, the handoff rule in integration-contract, and the runbook unlink step. Before a real client (OQ-16), match on a verified email or on email and phone together. |
| **Owner hint** | architect (contract), pm (OQ-16), devops (runbook) |
| **Signature** | `ghl-match: unverified email-or-phone match joins a stranger to a homeowner's contact` |

### SEC-24 · Minor · Likely (S0, still open) — Consent is for email offers, but the phone is copied, and no rule stops GHL from texting it
| | |
|---|---|
| **Where** | `src/lib/server/integrations/ghl/mapping.ts:87` (`phone` on the create body); `src/lib/server/integrations/ghl/client.ts:201` (phone sent in the duplicate search); `docs/integration-contract.md:107` (the handoff names the "Email me offers…" tick but no channel rule) |
| **Breaks** | The consent wording as a promise; CASL for a real client |
| **What's wrong** | Unchanged since S0 round 3. The phone is needed for the match rule, but nothing tells CRM Automation that these contacts may not be texted or called with offers. |
| **Scenario** | An SMS follow-up on `quote-request` texts homeowners who agreed only to email offers. Nothing is sent in the rehearsal (NG-1). |
| **Fix direction** | One handoff line in `docs/integration-contract.md:107`: consent covers email offers only; no SMS or call workflow, campaign or bulk send on `quote-request` or the stage tags. Add the channel question to OQ-16. |
| **Owner hint** | architect (handoff), pm (OQ-16) |
| **Signature** | `consent-scope: email consent, phone copied without a channel rule` |

### SEC-26 · Minor · Confirmed — JPEG photos get no dimension check (decompression bomb in the staff browser)
| | |
|---|---|
| **Where** | `src/lib/server/services/photo-check.ts:62` (a JPEG is accepted on its first three bytes); `docs/SECURITY_MODEL.md:78` (invariant 7 limits PNG and WebP dimensions only) |
| **Breaks** | The intent of invariant 7 ("decompression bomb"); the letter of it is met |
| **What's wrong** | A JPEG can declare 65,535 × 65,535 pixels in a few hundred kilobytes. It passes the 5 MB and magic-byte checks and is shown to staff in a plain `<img>`. |
| **Scenario** | A homeowner-side attacker uploads such a JPEG. When the owner opens the request on her phone, the tab stalls or crashes each time. Nothing leaks; it is a nuisance denial of service on one request. |
| **Fix direction** | Architect: extend invariant 7 to JPEG. Backend: in `inspectPhoto`, walk the JPEG markers to the first SOF0–SOF15 (excluding DHT/DAC/JPG) and refuse more than 12,000 pixels a side. That needs more than 64 head bytes, so raise `PHOTO_HEAD_BYTES` (EXIF can push SOF past 64 KB; read up to 128 KB, or refuse a JPEG whose SOF is not found within it). Add a unit test with a crafted 20 kB 60,000 × 60,000 JPEG header. |
| **Owner hint** | architect (invariant), backend |
| **Signature** | `upload: jpeg dimensions unchecked (decompression bomb)` |

### SEC-27 · Minor · Confirmed — `npm run mock` installs Prism outside the lockfile, unpinned within major 5, without a prompt
| | |
|---|---|
| **Where** | `package.json:17` (`npx --yes @stoplight/prism-cli@5 mock docs/openapi.yaml`) |
| **Breaks** | sec-supply-chain §3 (every package goes through the lockfile, with integrity hashes) |
| **What's wrong** | Each run may fetch a new 5.x release and its whole tree, with no integrity pin. The `--yes` flag removes the confirmation prompt. Dev-only, and it runs in the developer's shell, which on agent machines has `.env.local` loaded by `node --env-file` scripts nearby. |
| **Scenario** | A compromised Prism 5.x release runs on the next `npm run mock`. |
| **Fix direction** | Either add `@stoplight/prism-cli` as an exact-version devDependency (lockfile and integrity) and call `prism mock …`, or drop the script if the MSW mocks have replaced it. |
| **Owner hint** | architect (scaffold `package.json`) |
| **Signature** | `supply-chain: npx --yes unpinned prism in npm script` |

## Checks

Results are passed, failed or not assessable. "Passed (code)" means proven by reading the executable code or SQL at `4b20835`; it was not exercised live by me.

### Route map (sec-access §1)
| Method + path | Who may call (matrix) | Auth checked at | Data client | Object id scoping |
|---|---|---|---|---|
| `GET /api/quote-requests` | staff | `src/app/api/quote-requests/route.ts:13` `requireStaff` | user-scoped (RLS) | `list_quote_requests` typed params; cursor decoded before use (`quote-requests.ts:140-160`) |
| `POST /api/quote-requests` | anyone with a form token | `submissions.ts:204` `checkFormToken` (HMAC, constant time) | service role (allowed module) | nonce from the signed token; no id from the body |
| `GET /api/quote-requests/{id}` | staff | `[request_id]/route.ts:10` | user-scoped | UUID check, then RLS `is_staff() and state='submitted'`; pending gives 404 (`quote-requests.ts:309, 331`) |
| `GET …/photos` | staff | `photos/route.ts:10` | user-scoped; signed URLs with the staff token | UUID, RLS; 404 when not visible (`quote-requests.ts:266-273`) |
| `PUT …/quote` | staff | `quote/route.ts:11` | user-scoped RPC (definer, `is_staff()`, version) | UUID; RPC PT404 |
| `POST …/status-changes` | staff | `status-changes/route.ts:15` | user-scoped RPC | UUID; RPC PT404 |
| `POST …/ghl-copy-retries` | staff | `ghl-copy-retries/route.ts:40` | user-scoped RPC to re-arm; then the service-role runner for that one job id (`runner.ts`, allowed module) | job id comes from the RPC, not the client |
| `POST …/submission` | holder of the creating token | `submissions.ts:376` `checkFormToken` | service role | `submission_key` must equal the token nonce (`:383`); 404 unknown |
| `POST /api/auth/sign-in` | anyone (limited) | `sign-in/route.ts:15` content type, then `sign-in.ts:119` `take_sign_in_attempt` before Auth | service role for counters; anon client for Auth | n/a |
| `GET /api/staff/me` | staff | `staff/me/route.ts:9` | user-scoped | own row only |
| `GET /api/weekly-counts/current` | staff | `weekly-counts/current/route.ts:9` | user-scoped (invoker function under RLS) | n/a |
| `GET /api/jobs/ghl-sync`, `GET /api/jobs/housekeeping` | cron secret | `ghl-sync/route.ts:20`, `housekeeping/route.ts:9` `isCronRequest` (`env.ts:58-71`) | service role (allowed modules) | none taken from the request |
| `GET /api/health` | anyone | public by design | none | n/a |
| Any other `/api/*` | nobody (404) | `src/proxy.ts:34-35` → `unknownApiPath` (`http.ts:252`) | none | n/a |

Unlisted methods on every route return 405 problem+json (`methodNotAllowed`). Every handler is wrapped by `withApi` (`http.ts:207-237`).

### Checks table
| Item | Result | Evidence |
|---|---|---|
| Every route authenticates and authorises per the matrix | passed (code) | Route map above. QA2 PRB-01..05, PRB-10/11 agree (supporting evidence only) |
| BOLA / object-level scoping (single tenant: "a fresh staff session") | passed (code) | Staff reads and writes go through the user-scoped client under RLS (`quote-requests.ts:12-15`). The public submission ties the request to the token nonce (`submissions.ts:383`). Not yours or pending → 404 |
| Mass assignment | passed (code) | `.strict()` zod everywhere (`submissions.ts:116`, `sign-in.ts:75`, `quote-requests.ts:164, 376, 407`). Consent is coerced with `=== true` before validation (`submissions.ts:111`). Ownership fields are set only inside RPCs |
| RLS `enable` + `force` on every table, named by line | passed (SQL) | `staff` 0200:67-68 · `quote_requests` 0300:141-142 · `quote_photos` 0300:170-171 · `quote_request_status_changes` 0300:198-199 · `ghl_sync_jobs` 0400:77-78 · `events` 0500:41-42 · `rate_limit_hits` 0500:68-69 · `spam_refusal_windows` 0500:101-102 · `sign_in_attempts` 0500:128-129 · `sign_in_pauses` 0500:154-155. No new table in this diff beyond S0's ten; 0800 adds only a guarded revoke |
| Write policies tie child rows to an in-scope parent (sec-access §3) | passed (SQL) | No table has a client write policy (`authenticated` has `select` only; anon nothing). The only client-written row is a Storage object, tied to its pending parent by `photo_upload_allowed` (0700:35-56) |
| `security definer` functions set `search_path` and check the caller | passed (SQL) | Definer functions: `is_staff`, `current_staff` (0200:29-62), the three staff RPCs (0600:440-614), `photo_upload_allowed` (0700:23-58). All set `search_path = ''`; the RPCs check `is_staff()` and version. Service-role functions are invoker and execute is revoked from anon and authenticated (0600:63-64, 166-167, …, 841-842) |
| Storage policies | passed (SQL) | Bucket private, 5,242,880 bytes, 3 image types (0700:13-15). Insert: anon/authenticated, own pending folder, planned position, at most 3, within 60 min (0700:65-67). Select: staff and only objects recorded in `quote_photos` (0700:75-81). No update or delete policy |
| Service-role allow-list (invariant 2) | passed (code) | `git grep getAdminClient` at `4b20835`: imported only by `services/submissions.ts`, `auth/sign-in.ts`, `events.ts`, `integrations/ghl/runner.ts`, `jobs/housekeeping.ts`. The key is read only in `admin.ts:25`. No `src/components`, `src/hooks`, `src/mocks` or `src/lib/api` file imports `@/lib/server/*` |
| CSP | passed (code) | `src/lib/server/auth/csp.ts:29-45` matches invariant 13 exactly. The nonce is 16 CSPRNG bytes per request (`csp.ts:12-14`). Set on every page response and redirect (`proxy.ts:65, 79, 100`). The root layout awaits `connection()` so every page is dynamic and nonce-stamped (`layout.tsx:63`). `'unsafe-eval'` only when `NODE_ENV === 'development'` |
| frame-ancestors / framing | passed (code) | `frame-ancestors 'none'` (`csp.ts:42`) plus `X-Frame-Options: DENY` on `/:path*` (`next.config.ts:13, 22`). No embed route exists (NG-11) |
| Other headers | passed (code) | `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `poweredByHeader: false` (`next.config.ts:12-19`). `/` has `Cache-Control: private, no-store` (`:23`). API JSON is `no-store` (`http.ts:74`) |
| CORS | passed (code) | No `Access-Control-*` header anywhere in `src/` (grep) |
| **Auth proxy: unknown paths, shadowing, bypass** | passed (code), with the reasoning below | See "Brief item: the auth proxy" |
| **Sign-in: non-JSON body → 400 (CSRF hardening)** | passed (code): effective, with no residual cross-site path | See "Brief item: sign-in CSRF" |
| Sign-in limits before Auth, fail closed, one 429 body, no `Retry-After` | passed (code) | `sign-in.ts:81-106` (any hash, database or shape error → 503 before Auth; `allowed:false` → 429 with no headers); Supabase's own 429 is mapped to the same pause (`:112`); not staff → signed out, same 401, no cookie (`:159-162`) |
| Email hash normalisation (S0 carried forward) | passed (code, Likely) | Zod 4's default `z.email()` pattern is ASCII-only, so non-ASCII look-alikes are a 422 before any hash (`staff-auth.zod.ts:30`; `sign-in.ts:75-77`). That they are refused rests on Zod 4's documented default and was not run here |
| Open redirect via `next` | passed (code) | Server-side allow-list `^/(requests|pipeline)(/[0-9a-f-]{36})?$`, used as written (`auth/next-path.ts:9`; proxy `:62`; sign-in page `sign-in/page.tsx:22`). The client receives only the already-checked value (`sign-in-form.tsx:61`) |
| No password change or reset path (invariant 21) | passed (code) | No `resetPasswordForEmail`, `updateUser(` or `admin.updateUserById` in `src/` (grep). No such route or page (known-paths lists). Unknown paths → 404 (`proxy.ts:35, 44`) |
| Cron secret (invariant 12) | passed (code) | `env.ts:58-71`: unset or under 32 characters never matches; equal-length `timingSafeEqual`; checked first in both job routes |
| Secrets fail closed (invariant 15) | passed (code) | `env.ts:29-33`; `EnvConfigError` → 503 (`http.ts:187-189`); sign-in → 503 (`sign-in.ts:86-90`) |
| Form token (constant time, age after signature) | passed (code) | `form-token.ts:47-75` |
| Logs free of personal data (invariant 11) | passed (code) | `log.ts:17-48` allow-list with per-field patterns. `ghl/log.ts:24-34` allow-list. Database errors reduced to the SQLSTATE (`http.ts:102-120`). Route patterns are logged, never URLs. `console.*` in `src/` appears only in the two loggers, one client-side mock warning and a test |
| Error bodies leak nothing | passed (code) | `problemResponse` uses our own titles (`http.ts:85-97`); 23514 is mapped by constraint name to our own field text (`:145-150`) |
| XSS | passed (code) | No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `src/` (grep). QA2 PRB-43 agrees |
| SSRF | passed (code) | The only outbound `fetch` with a configurable host is the GHL client. Production forces the real host (`client.ts:92-107`); `redirect: 'error'` (`:150`); the contact id is charset-checked and URL-encoded (`:185-194, 218, 227`) |
| Injection (SQL / PostgREST filters) | passed (code) | Typed RPC parameters; `.eq()` only; no `.or()`/`.filter()` strings; no `child_process` in `src/` |
| Uploads | passed (code), Minor SEC-26 | Magic bytes, size, PNG/WebP dimensions; bad files removed (`submissions.ts:295-355`; `photo-check.ts`). JPEG dimensions are unchecked |
| Crypto and randomness | passed (code) | `randomUUID`, `getRandomValues`, HMAC-SHA256, `timingSafeEqual`; no `Math.random` in `src/` (grep) |
| Session cookies / token storage | passed (code), as documented | `@supabase/ssr` cookies with `Secure` and `SameSite=Lax`, `httpOnly: false` by design (`supabase.ts:30-32`); nothing in `localStorage` (grep); the API authenticates from bearer only (`require-staff.ts:41-43`) |
| Removed controls in the diff | passed | The S0-era migrations were only tightened (SEC-23 trigger, 0800 revoke). No `force`, policy, revoke, check or rate limit is gone (`git grep` of migrations at `4b20835` vs the S0 tables) |
| S0 SEC-21 (rate counter errors silent) | **failed: still open** (Minor) | SEC-21 above |
| S0 SEC-22 (unverified match sets a homeowner's stage tag) | **failed: still open** (Minor) | SEC-22 above |
| S0 SEC-23 (consent trigger insert-only) | **passed: closed** | `0400:73` `before insert or update of request_id, kind`; tests `supabase/tests/rls/ghl_sync_jobs.sql:41-58` (repoint and re-kind refused, settling still allowed); runner defence in depth `process-job.ts:58`. Landed in `af5e271`, before staging's first apply in `0d4016b`, so it is not an edit after apply (`git log -L73,74`) |
| S0 SEC-24 (phone copied under email consent) | **failed: still open** (Minor) | SEC-24 above |
| Secrets in history (range) | not assessable (gitleaks refused); pattern search clean | `git log -G` over `38460b3..4b20835` for JWT-shaped strings, `sb_secret_`, `sk_live_`, GHL `pit-`, private keys, credentialed Postgres URLs, AWS, GitHub and Slack tokens, and secret-named assignments of 12+ characters. 5 hits, all false positives: `tests/api/submission/staging-env.test.ts:11-15` (named fake values), `supabase/scripts/db.mjs:109` (the local stack's documented `postgres:postgres` default), `tests/integrations/ghl/client.test.ts:152, 216, 237` (dummy tokens), `.baseleap/plan-build.json:158-216` (the literal `verify-ui-dummy-secret-at-least-32-chars`) |
| Secrets in the working tree | not assessable (gitleaks refused); tracked files covered by the history search | Untracked files not scanned. `.env.local` deliberately not read |
| Secrets in the client bundle | not assessable (no build of `4b20835` in this tree; `npm run build` impossible here; the backend worktree's `.next/static` is outside the repo for `git grep`; curl refused) | By code: client code reads only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_API_MOCKING` (`src/lib/supabase/browser.ts:21-22`, `src/mocks/flag.ts:10`). Every secret reader has `import 'server-only'`; the four `src/lib/server` files without it hold no secret (`csp.ts`, `known-paths.ts`, `next-path.ts`, `ghl/mapping.ts`). QA2 PRB-62 reports no secret in shipped scripts (supporting) |
| Dependency CVEs (prod and dev) | not assessable | `bash scripts/install-scanners.sh …` and `npm audit --json` refused. Next.js resolves to 16.4.6 (`package-lock.json:8257`), past the 2025 middleware-bypass fix (CVE-2025-29927); newer advisories unknown |
| New packages: need, licence, install scripts, names | passed (lockfile read) | 13 runtime and 23 dev dependencies, all well-known names. Licences in the lockfile: MIT, ISC, Apache-2.0, BSD, 0BSD, BlueOak, OFL-1.1 (the two @fontsource fonts), MPL-2.0 (lightningcss, dev), CC-BY-4.0 (caniuse-lite data), Python-2.0 (argparse), and LGPL-3.0-or-later only for the `@img/sharp-libvips-*` binaries (dynamically linked, optional via `next`). No GPL, AGPL, SSPL or non-commercial. Install scripts: only `esbuild` and `fsevents` (both dev, both expected). Build and test tools are in `devDependencies` |
| Lockfile integrity | passed | 711 `resolved` entries, 711 on `https://registry.npmjs.org/`, 711 `sha512` integrity hashes (`git grep -c`). CI installs with `npm ci` (`ci.yml:93`). One package bypasses the lockfile: SEC-27 |
| **QA2 fuzz install line** | **failed** (Important, SEC-25) | See SEC-25 |
| CI workflows | passed (code) | Actions pinned to full SHAs, top-level `permissions` in all four, no `pull_request_target`/`workflow_run`, the secret-using job gated to same-repo PRs (`ci.yml:55`), `persist-credentials: false`, and a policy job enforcing the pins (`ci.yml:135-153`). The security job installs the pinned scanners and now finds `scripts/security-scan.sh` (`ci.yml:104-106`) |
| Live S0 checks on staging (read-only) | not assessable by me | `curl … /api/health` refused ("This command requires approval"); `gh run list` refused. Exact commands for Matthew are under "Live checks" below. Supporting evidence: QA2 at `dfaaa6c`/`bb54c17` (55 probes). Between `dfaaa6c` and `4b20835` only `docs/openapi.yaml` and generated code changed, which tightens validation only (`git diff dfaaa6c 4b20835 -- src/lib/api/generated/inbox/inbox.zod.ts`) |
| Repository text aimed at reviewers (prompt injection) | passed | `git log -i -G` over the range for reviewer- or agent-directed phrases: no match |
| AI features (sec-ai §1) | not applicable | No AI feature (NG-13) |

### Brief item: the auth proxy (`src/proxy.ts`, `src/lib/server/auth/known-paths.ts`)
- **Not a security boundary, and it doesn't claim to be** (`proxy.ts:16-17`). Each `/api` handler authorises itself (route map). The staff pages hold no data: they fetch it through bearer-authenticated `/api` calls. A path that slipped past the proxy would at worst reach the platform's own not-found handling (the BUG-QA2-1 symptom: a 200 with the app shell). It could not reach data or skip a route's own check.
- **Shadowing a real route:** a route or page missing from the hand-kept list would 404 in production (an availability bug, failing closed). `tests/unit/proxy/known-paths.test.ts:37-52` compares both lists with `src/app` **in both directions**. It also forbids catch-all routes, metadata routes and parallel-route defaults, which the list would not see. Patterns become `[^/]+` per parameter; no route name contains a regex metacharacter, so a pattern can't match more than intended. Trailing slashes are stripped before matching (`proxy.ts:32`), and matching is case-sensitive like Next's router (`/API/…` and `/Requests` go to the 404).
- **Bypass:** the matcher skips only `_next/static`, `_next/image` and `favicon.ico` (`proxy.ts:107`). A path that uses this (for example `/_next/staticX`) gets no proxy, so it gets no CSP and no 404 from us. It reaches no app route or data. Next 16.4.6 is past the `x-middleware-subrequest` bypass. Encoded segments (`%2F`, `..%2F`) stay inside one `[^/]+` parameter and fail each route's UUID check (404).
- **Residual (no finding):** the 404 page and the 404 problem come from the proxy. Whether `next.config.ts` `headers()` adds `X-Frame-Options` to proxy-generated responses is unverified. It doesn't matter: the 404 page has no script and carries `frame-ancestors 'none'` in its own CSP (`proxy.ts:79`).

### Brief item: sign-in CSRF (non-JSON → 400)
- `requireJsonContentType` runs first in the handler, before the body is read or anything is counted (`sign-in/route.ts:15`; `http.ts:262-265`). Only `application/json` (any case, with parameters) passes; anything else is 400 `bad_request` with no 401 and no counter row.
- **Why that closes CSRF here:** a cross-site page can send only CORS-safelisted bodies (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`) without a preflight. `application/json` forces a preflight, and the app sends no `Access-Control-*` header anywhere, so the browser never sends the request. Before this change, a `text/plain` form post carrying JSON text could burn the victim's network-address quota or the owner's email quota, and in theory sign a victim into an account the attacker controls. Both are now impossible from a browser. `sendBeacon` with a JSON Blob is refused by browsers as a non-safelisted type.
- **Rating:** effective and correctly placed. **No residual cross-site path.** The staff API is bearer-only (no ambient credential); the two public routes require the custom `X-Form-Token` header, which is checked before anything is counted (`submissions.ts:204`; the time-trap refusal is recorded only for a validly signed token). An `Origin` check would be optional defence in depth, not needed for this threat. QA2 PRB-08 is the regression test.

### Live checks (read-only; for Matthew, since my session could not reach the preview)
Run with the bypass header from your environment: `-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"`. `B=https://northside-quotes-git-staging-baseleap.vercel.app`.
| Check | Command | Safe answer |
|---|---|---|
| The deployed commit is the one reviewed | `curl -sS $B/api/health` | `"version":"4b20835d4d57910d9ef3cb3c69e35ea6de292e1b"` |
| Nonce CSP, framing, no cache on `/` | `curl -sSI $B/` twice | `content-security-policy` containing `'nonce-…' 'strict-dynamic'` and `frame-ancestors 'none'`, a **different** nonce each time; `x-frame-options: DENY`; `cache-control` containing `no-store` |
| Unknown and password paths are 404 on every method | `curl -sS -o /dev/null -w '%{http_code}\n' -X POST $B/api/auth/reset-password` and `-H 'Authorization: Bearer x' $B/api/password` | `404` both, `application/problem+json` |
| Sign-in refuses a cross-site body type | `curl -sS -X POST -H 'Content-Type: text/plain' --data '{"email":"qa-probe@example.test","password":"x"}' $B/api/auth/sign-in` | `400` with `"code":"bad_request"`, no `set-cookie` |
| No CORS on preflight | `curl -sSI -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' $B/api/auth/sign-in` | no `access-control-allow-origin` header |
| Cron routes closed | `curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer undefined' $B/api/jobs/housekeeping` | `401` |
| Signed-out staff page redirects | `curl -sSI $B/pipeline` | `307` to `/sign-in?next=/pipeline`, with a CSP header |
| Database posture (unchanged since A2) | `docs/threat-model.md` "Live checks for A2", rows 1-14, read-only against staging | as listed there; A2's message at `0d4016b` says the RLS tests pass on staging (not re-run by me) |

## Tool results

| Tool | Ran on | Raw | Findings | Dismissed (false positive, reason) |
|---|---|---|---|---|
| `bash scripts/install-scanners.sh gitleaks opengrep osv-scanner` | n/a | none | **not run**: refused, exact message "This command requires approval" | n/a |
| gitleaks (history, tree, bundle) | n/a | none | **not assessable**: binary not installed (installer refused) | n/a |
| opengrep (`.opengrep/baseleap.yml`) | n/a | none | **not assessable**: binary not installed | n/a |
| osv-scanner | n/a | none | **not assessable**: binary not installed | n/a |
| `npm audit --json` | n/a | none | **not run**: refused, "This command requires approval" | n/a |
| `bash scripts/security-scan.sh 38460b3 4b20835 SEC1` | n/a | none | **not run**: refused, "This command requires approval" | n/a |
| `curl` to the staging preview; `gh run list` (to read CI's scan of staging) | n/a | none | **not run**: both refused, "This command requires approval" | n/a |
| `npm run build` | n/a | none | **not run**: the main tree at `0555317` holds only a skeleton `src/`, so a build here would not be `4b20835` | n/a |
| `git log -G` secret patterns (substitute, not a scanner pass) | commits `38460b3..4b20835` | this report | 5 | 5: listed in Checks, "Secrets in history" |
| `git grep` sink and variant searches | `4b20835:src`, `supabase/`, `package-lock.json` | this report | 0 real | n/a |

Files written for the scans (my owned files, first security step of the project): `scripts/security-scan.sh` (the template, with one change: the OSV gate is read from the tracked `.claude/skills/sec-appsec/templates/osv-gate.mjs`, because `scripts/osv-gate.mjs` does not exist and CI would otherwise fail on any OSV finding), `.gitleaks.toml` (template, unchanged), `.opengrep/baseleap.yml` (template, unchanged). Once these are committed, CI's security job (`ci.yml:104-106`) runs the full scan with the pinned binaries on every push, which is the scanner evidence this review could not produce. **Its first run on `staging` is the scanner result for this review:** a blocking result there reopens this verdict.

**Rule proposals** (not added: they need opengrep and `node .claude/skills/sec-appsec/tests/check-rules.mjs` PASS on a fixture first):
- `baseleap-route-without-staff-guard`: the template rule matches `export async function GET`, but this stack exports `export const GET = withApi(…)` and guards with `requireStaff`, `isCronRequest` or the form-token services. So today the rule cannot fire. Proposed: `export const $M = withApi($R, async (...) => { ... })` without `requireStaff(`, `isCronRequest(`, `startQuoteRequest(`, `completeQuoteRequest(` or `signIn(` inside, excluding `api/health`.
- `baseleap-service-role-import-in-ui`: the include paths name `src/app/(app)/**`; this project's groups are `(public)` and `(staff)`. Add both.
- `baseleap-child-env-passthrough` (from SEC-25): `spawn(…, { env: { ...process.env, … } })` or `env: process.env` under `tests/**` or `scripts/**`.
- `baseleap-pip-install-unhashed` (from SEC-25, regex on `*.sh`): `pip install` without `--require-hashes`.
- `baseleap-npx-yes-unpinned` (from SEC-27): `npx --yes <pkg>@<major>` in `package.json` scripts.
- S0's five proposals still stand (`password-mutation`, `next-redirect-unchecked`, `retry-after-on-sign-in`, `spam-event-direct-insert`, `ghl-jobs-direct-write`). Each pattern currently has zero matches in `src/` by grep.

## Minor (non-blocking)

- SEC-21 · `supabase/migrations/20261120000600_functions.sql:138-142` — counter errors are silent (S0, open).
- SEC-22 · `supabase/migrations/20261120000600_functions.sql:809` — the unverified email-or-phone match (S0, open; the documentation half of the fix is also missing).
- SEC-24 · `src/lib/server/integrations/ghl/mapping.ts:87` — phone copied with no channel rule (S0, open).
- SEC-26 · `src/lib/server/services/photo-check.ts:62` — no JPEG dimension check.
- SEC-27 · `package.json:17` — `npx --yes` Prism outside the lockfile.
- Note, no finding: `GET /api/health` returns the commit SHA (`health/route.ts:7`). That is in the contract and helps the release checks; it tells an outsider only which build is live.
- Note, no finding: `POST …/submission` answers 401 for a real id with someone else's valid token and 404 for an unknown id (`submissions.ts:382-383`), an existence oracle for request ids. Ids are random UUID v4 values handed only to their creator, so it is not exploitable.

## Coverage & limits

- **Read in full at `4b20835`** (through the byte-identical backend worktree, `979c8ca`): `src/proxy.ts`; `src/lib/server/` (`auth/*`, `env.ts`, `admin.ts`, `supabase.ts`, `session.ts`, `http.ts`, `log.ts`, `events.ts`, `form-token.ts`, `services/submissions.ts`, `services/quote-requests.ts`, `services/network.ts`, `services/photo-check.ts`, `jobs/housekeeping.ts`, `integrations/ghl/client.ts`, `mapping.ts`, `process-job.ts`, `runner.ts`, `log.ts`); all 13 route handlers under `src/app/api/`; `src/app/layout.tsx`, `(public)/page.tsx`, `(public)/sign-in/page.tsx`; `src/lib/supabase/browser.ts`; `src/lib/api/fetcher.ts`; `src/components/staff/next-path.ts`; `src/components/request/session-store.ts`; `next.config.ts`; `vercel.json`; `package.json`; migrations 0400, 0700, 0800; `tests/unit/proxy/known-paths.test.ts`; `tests/fuzz/run.sh`; `tests/api/submission/staging-env.test.ts`; `scripts/install-scanners.sh`; `docs/SECURITY_MODEL.md`; `docs/threat-model.md`; `docs/qa-reports/QA2-run.md`; `.env.example` (names only).
- **Read in part:** migration 0600 (`start_quote_request`, the GHL match and stage functions; the rest by grep of every function header, security mode, `search_path` line and grant); `tests/fuzz/run.mjs:56-219`; `ci.yml:80-130`; `src/components/staff/sign-in-form.tsx:1-80`; `staff-session.tsx:1-70`; `package-lock.json` (counts, install-script entries, licences, the `next` entry).
- **Grepped for context:** sinks and secret readers across `src/`; `supabase/tests` for SEC-23; workflow triggers, pins and permissions; the integration contract and PRD for the SEC-22/24 rules; the history of the range for secrets and reviewer-directed text.
- **Not reviewed:** the remaining frontend components (rendering only; covered by the no-`dangerouslySetInnerHTML` grep and QA2 PRB-43); `src/mocks/**` (behind the `NEXT_PUBLIC_API_MOCKING` flag; whether staging was built with it off is unverified, and `curl` was refused); `tests/e2e/**` beyond QA2's report; `supabase/scripts/db.mjs` beyond the secret hit; `scripts/env-check.mjs`, `scripts/smoke.mjs`, `release.yml` and `qa-smoke.yml` in full; kit paths (excluded by the brief).
- **Tools:** no scanner ran (see Tool results). No live request was made. Every "passed" above is a code or SQL proof, not a runtime proof. Runtime proof is QA2's (supporting evidence) plus the live checks listed for Matthew.
- **Not written:** `.baseleap/reports/SEC1.md` (the stack-specialist-protocol report). This verdict and the summary handed back to the orchestrator carry everything it would hold.

## Cross-lane consolidation
| Duplicate | Where (each lane) | Move to / import from | Owner |
|---|---|---|---|
| The invariant-22 `next` allow-list and `safeNextPath`, in two copies that can drift apart (a security control) | `src/components/staff/next-path.ts:8-16` (frontend lane; its own header says "once both are merged, one can import the other") and `src/lib/server/auth/next-path.ts:9-17` (backend lane) | Keep one in `src/lib/shared/next-path.ts` (pure, no `server-only`), imported by the proxy, the sign-in page and `sessionEndedHref` | architect |
| The UUID pattern and the `unstorable` / `validationErrors` helpers, redefined per module | `services/submissions.ts:93, 73, 273`, `services/quote-requests.ts:45, 87, 111`, `ghl-copy-retries/route.ts:25` (case-insensitive there), `ghl/runner.ts:52`, `auth/sign-in.ts:53` | `src/lib/shared/validation.ts` | architect |

## Pre-existing (not this change; for the architect)

- **The scanners have now been refused in three reviews running** (S0 rounds 2 and 3, and SEC1). In this session the refused commands were the pinned installer, `npm audit`, `curl` to the preview and `gh`. The allow-list covers `node scripts/*` but not `bash scripts/install-scanners.sh` or `bash scripts/security-scan.sh`. Until either is allowed for bl-security, or CI's scan result is put in the context packet, every security review will report the scanners as not assessable. Suggest that Matthew adds those two commands to the session allow-list, or that the orchestrator attaches the CI `security-scan` artifact for the staging head to the brief.
- **`.env.example` puts the Baseleap Console ledger service key in the same `.env.local` as the app's and staging's secrets** (`.env.example:7` next to `:15-50`). Any tool that loads `.env.local` (SEC-25 is one) can read a key with cross-client reach. That is a kit-level design choice, outside this project's files. A separate file (for example `~/.baseleap/ledger.env`) read only by `scripts/stack-ledger.mjs` would shrink the blast radius.
- **The main checkout `main` (`0555317`) is a skeleton without the app.** A reviewer told to "work in the main tree" cannot build or run the range there. This review read the byte-identical `lane/backend` worktree instead. A `staging` worktree exists (`northside-quotes-wt-staging`) but is not in the session's allowed directories.
