
## CI pre-push scan

*(2026-11-27, rounds 6 and 7. Scope: two history-only entries added to `.gitleaks.toml`, then the full scan in CI mode from the main tree, including Matthew's uncommitted rewording of `.baseleap/reports/OPS1.md` and edit of `.github/scripts/staging-db-check.mjs`. `.opengrep/baseleap.yml` and `scripts/security-scan.sh` are unchanged. This is not a re-review of application code. No value is printed here: findings are named by rule, file, line and short SHA, and fake values are described, not quoted.)*

**Verdict for this round: CI's gitleaks scan will see 0 findings.** Both new entries work, and each one is pinned to one commit, one file, one rule and the whole matched text. The security verdict at the top of this file is unchanged (BLOCKED on SEC-28 only).

**Read:** `.gitleaks.toml`, `scripts/security-scan.sh`, `.github/workflows/ci.yml` (the `security` job's range: `origin/${base_ref:-main}..HEAD`), `.gitignore`, `.baseleap/reports/OPS1.md:298-301` as committed in `42d15a3`, `.github/scripts/staging-db-check.mjs` as committed in `b0df843` (in full, read again in round 7 with a read-only `git show`, so each regex could be written against the exact committed text), and the scan output in `.baseleap/reviews/ci/`.

### The changes
| # | Entry | Commit pin (full SHA) | Path pin | Rule pin | Value pin (`regexTarget = "match"`, anchored `^...$`) |
|---|---|---|---|---|---|
| 6 (round 6) | `.gitleaks.toml:154-174`, header note `:21-24` | `42d15a30be83e476ee57d26e07ab558419821364` only | `.baseleap/reports/OPS1.md` | `postgres-connection-string-with-password` | one shape: the placeholder address with user `user`, password `password` and host `host`, then at most one closing backtick |
| 7 (round 7) | `.gitleaks.toml:176-225`, header note `:25-28` | `b0df84353a0a7f7e717e5c5c4b46768202a035fe` only | `.github/scripts/staging-db-check.mjs` | `postgres-connection-string-with-password` | ten shapes, one per distinct fixture text (table below) |

Both entries are global `[[allowlists]]` with `targetRules` and `condition = "AND"`, so all four pins must hold together. Tree and bundle findings carry no commit, so neither entry can apply to those scans. They apply only to history, and only to those two immutable commits.

**Entry 7: the ten shapes and the 14 lines they cover** (`.gitleaks.toml:204-225`; every shape is the whole match, from `postgresql://` to the trailing characters the rule's host class `[^\s'"]+` swallows):
| Shape | Lines in `b0df843` | What it is (no value quoted) |
|---|---|---|
| help text | 225 | `verdict()` hint showing the placeholder address user / password / host, then `...).` |
| pooler "good" | 294 | the self-test's fixed made-up password word, user `postgres.${REF}`, host `${POOLER}` (template placeholders, not values), port 5432, db `postgres`, then a backtick and `;` |
| direct | 306, 381, 383, 399 | the same made-up word, user `postgres`, host `db.${REF}.supabase.co`, then a backtick and `,` |
| Supabase placeholder | 310, 391 | `[YOUR-PASSWORD]` with `${REF}` / `${POOLER}` |
| percent-encoded | 352 | a made-up already-encoded password with `${REF}` / `${POOLER}` |
| allowed punctuation | 354 | a made-up password of RFC 3986 punctuation with `${REF}` / `${POOLER}` |
| sentinel | 409 | every part a `${secrets[n]}` interpolation (the four sentinel strings of the "no secret reaches the output" check, array at `:407`) |
| sentinel + `\n` | 410 | the same plus a literal backslash-n |
| sentinel direct | 412 | sentinel parts, direct-host shape, sentinel as port |
| sentinel bare | 414 | sentinel user, password and host only |

**Kind: fake by construction. Confidence: Confirmed** (every line read in the commit). None is a credential, so no rotation is needed.

### Proof (round 7, entry 7; the same method as entry 6 in round 6)
Scratch configs and fixtures are in `.baseleap/reviews/SEC1/allowlist-test/`. Afterwards every fixture and CSV was overwritten with a neutral note (`rm` was refused in round 6). A `gitleaks dir` on `.baseleap/reviews/SEC1/` with the real config then reported `no leaks found`.
| Test | Config | Target | Expected | Result |
|---|---|---|---|---|
| A. Control | the postgres rule alone, no allowlist (`control.toml`) | `gitleaks git` on `b0df843~1..b0df843` | 14, at the 14 lines | **14**: lines 225, 294, 306, 310, 352, 354, 381, 383, 391, 399, 409, 410, 412, 414, all in `.github/scripts/staging-db-check.mjs`, same columns as CI's list |
| B. Real | `.gitleaks.toml` | the same commit | 0 | **0** (`no leaks found`), run again on the final file text |
| C. Commit pin | `.gitleaks.toml` | `gitleaks dir` on fixtures: 10 exact shapes (P1-P10) and 15 negatives (N1-N15) in a file named `.github/scripts/staging-db-check.mjs`, plus 2 exact shapes in `docs/other.mjs` | 27 (dir findings have no commit) | **27** |
| D. Path and value pins | entry 7 with its commit pin removed (`nocommit.toml`) | the same fixtures | 17 (only P1-P10 dropped) | **17**: N1-N15 (fixture lines 22-50) and both `docs/other.mjs` lines. P1-P10 (lines 2-20) dropped |

**Negatives that still fire with the commit pin removed (test D):** the help text with another host · the pooler shape with another password · a literal ref instead of `${REF}` · a literal direct host instead of the template · port 6543 · the `postgres://` scheme · the placeholder with another host · a trailing `?sslmode=` · another database name · **the four sentinels written out literally** · another `${secrets[n]}` index · `\r` instead of `\n` · `;` instead of `,` after the bare sentinel shape · a fully literal made-up pooler address · extra text after the closing `;` · and the exact shapes in another file.
**Rule pin:** checked by reading only (`targetRules`, `:195`). In the control, no other rule matches these lines, so a test would prove nothing more.

### `bash scripts/security-scan.sh origin/main HEAD ci` (main tree, gitleaks 8.30.1, opengrep 1.33.1)
Run twice: after the entry was added, and again after a comment-only fix to two line references in `.gitleaks.toml`. Both runs gave identical results. Exit **1**. The only cause is the untracked local files below. Range `origin/main..HEAD` = `67c0f0d..42d15a3` (20 commits, with `b0df843` and `42d15a3` among them).
```
gitleaks: 67 finding(s)
opengrep rule self-test: PASS (expected 7 · fired 7 · missed 0 · unwanted 0 · engine errors 0)
opengrep: 0 finding(s) in 95 changed file(s)
osv-scanner: done (.baseleap/reviews/ci/osv.json)
npm audit (prod, high+): done
```
| Scanner | Result |
|---|---|
| gitleaks history | **0** (`gitleaks-history.json` is `[]`). Round 6 had 14, all in `b0df843`; entry 7 drops them. `OPS1.md` stays at 0 |
| gitleaks tree | **67**, all in files that are untracked and git-ignored (`.gitignore:1` `.env.local`, `:21` `/playwright/.cache/`), so a CI checkout doesn't have them. **60** in `playwright/.cache/**`: 58 `generic-api-key` across nine `probe-state-*.json` (8 each in seven of them, 1 each in two), and 2 `jwt` in `auth/owner.json` and `auth/helper.json`. **7** in `.env.local`: 4 `jwt`, 1 `supabase-service-role-assignment`, 1 `postgres-connection-string-with-password`, 1 `generic-api-key`. These are real local values that were never committed, and they are never allowlisted. **0** in tracked files, including `.gitleaks.toml`, the reworded `OPS1.md`, the edited `staging-db-check.mjs`, and this review folder as it stood at scan time |
| gitleaks bundle | **0** (`.next/static` present) |
| opengrep self-test | `PASS (expected 7 · fired 7 · missed 0 · unwanted 0 · engine errors 0)`, stderr empty |
| opengrep scan | **0 findings** in 95 changed files (`results: []`, `errors: []`, `skipped_rules: []`) |
| osv-scanner | **clean** (`results: []`) |
| npm audit (prod, high+) | **0** vulnerabilities at any level (42 prod, 717 total dependencies) |
| Dependency diff | none (empty patch: `package.json` and `package-lock.json` are unchanged in the range) |

**Split asked for in the brief:** 67 = **67 untracked-local** (`playwright/.cache` 60, `.env.local` 7) + **0 that CI will see**.

### Checks this round
| Check | Result | Evidence |
|---|---|---|
| Entry 7 pinned to commit, path, rule and anchored whole match | **passed** | `:176-225`; tests B, C, D |
| Entry 7 is what drops the 14 | **passed** | tests A and B; nothing else in the config targets this rule in this file and commit (rule-level allowlists are path-pinned to other files, entry 6 to another commit, and the global paths don't match) |
| Other value, file or commit still fails | **passed** (run, not traced) | tests C and D, including the literal sentinels |
| Other rule still fails | **passed (by reading)** | `targetRules`, `:195` |
| The new config text trips no rule | **passed (scanned)** | tree scan: 0 findings in `.gitleaks.toml` (the at sign is written `\x40`) |
| Findings CI will see = 0 | **passed** | history 0, tracked-tree 0, bundle 0 |
| Opengrep self-test and scan | **passed** | output above |
| OSV and npm audit | **passed** | output above |

### Coverage & limits
- The scan ran on the working tree. CI's run after Matthew's commit adds one more commit to history, holding today's uncommitted edits (the `.gitleaks.toml` change, the reworded `OPS1.md`, the edited `staging-db-check.mjs`). All of those files had 0 findings in the tree scan, so the new commit should add none. **Unverified until CI runs**: that commit doesn't exist yet. This file was written after the scan and checked separately with `gitleaks dir`.
- CI pins gitleaks 8.30.1, the same version as here. A local run can't show CI's runner image.
- The `.baseleap/reviews/SEC1/` folder is untracked. If it is committed, its `.md` and `.toml` files are scanned in the tree, and they scanned clean.
- `node scripts/review-check.mjs` was not run on this fragment. It checks the full `SEC1.md`, which Matthew assembles.

### Notes for the orchestrator
- **CI's `security` job should be green on gitleaks** once this `.gitleaks.toml` is committed. The local exit 1 comes only from the 67 git-ignored local files.
- **Untracked scratch to drop (holds no value):** `.baseleap/reviews/SEC1/allowlist-test/`. Don't commit it.
- **Verdict:** unchanged. BLOCKED on SEC-28 (Important) only, 0 Critical, 6 Minor open. No live secret, no rotation.
