---
name: sec-supply-chain
description: Dependency and supply-chain review for bl-security — OSV-Scanner and npm audit on the lockfile, judging whether each CVE is reachable in production, reviewing every newly added package (need, maintenance, licence, install scripts, typosquats), and lockfile integrity. Use on every security-review step that changes package.json or the lockfile, and before every release.
---

# Security · Supply Chain & Dependencies

Every package added is code from a stranger running in the client's app. Fewer, well-maintained, correctly licensed dependencies — and known holes either fixed or consciously accepted.

## 1. Known vulnerabilities (via `scripts/security-scan.sh`)

- **OSV-Scanner** on `package-lock.json` (all known advisories across ecosystems) → `osv.json`.
- **npm audit** for production dependencies, high and above → `npm-audit.json`.

For each Critical/High advisory, decide:
| Situation | Severity |
|---|---|
| In a production dependency **and** the vulnerable function/path is used (or can't be ruled out) | Critical (Critical CVE) / Important (High) |
| Production dependency, vulnerable path demonstrably not used | Minor, with the reasoning |
| Dev-only dependency (build/test tooling) | Minor unless it runs in CI with secrets |
| Fix available | fix direction = the upgrade (note if it's a major version) |
| No fix available | Important + options (replace the package, mitigate, accept with Matthew's ruling) |

A scanner that couldn't run, or a lockfile it couldn't read, is **not assessable** — never "no vulnerabilities".

## 2. New dependencies in the diff (`dependency-diff.patch`)

For each package added or majorly upgraded:
- **Needed?** Could the platform or an existing dependency do it? (Small helpers are often a few lines of code.)
- **Maintained?** Recent releases, more than one maintainer, not deprecated, not archived.
- **Licence** compatible with selling client builds (MIT, Apache-2.0, BSD, ISC fine; GPL/AGPL/SSPL/Commons Clause/"non-commercial" → Important, Matthew decides).
- **Install scripts** (`preinstall`/`postinstall`) — why does it need them?
- **Name check** — typosquats of popular packages, recently transferred ownership, very new packages with high download claims.
- **Paid/licensed packages** (premium UI kits, paid SDKs) need a spend gate.
- In the right section: build/test tools in `devDependencies`, not shipped to production.

## 3. Lockfile integrity

`package-lock.json` changes only alongside `package.json` changes (or a deliberate update step); `resolved` URLs point at the npm registry; `integrity` hashes present; CI installs with `npm ci`.

---
Sources (ideas adapted, text written for Baseleap): google/osv-scanner (Apache-2.0 — lockfile scanning), Consensys/repo-security-review (no licence file — ideas only: dependency CVE phase with reachability validation), trailofbits/skills `supply-chain-risk-auditor` (CC BY-SA 4.0 — ideas only, no text reused: unassessable is not safe, absence of findings is not endorsement, maintainer and install-script risk).
