# Dependency vulnerability gate (OSV-Scanner)

Implemented in the `security` job of `.github/workflows/ci.yml`. It runs
`osv-scanner scan source -L package-lock.json --format json` and judges the JSON itself.

| Finding | Result |
|---|---|
| Critical or High in a package that **ships** | **Blocks** the job (red check) |
| Critical in a **dev-only** package | **Blocks** |
| High or lower in a **dev-only** package | Warning only: table in the job summary (package, version, severity, advisory, fixed version) plus an annotation for High |
| Medium or Low in a package that ships | Warning only |

## How dev vs shipped is decided

OSV reports a `dependency_groups` list for each package. A package is dev-only only if that list is
non-empty and every entry is `dev`. Anything else counts as shipped: a missing list, a mixed
`dev`/`prod` list, or an unfamiliar group. When in doubt the gate blocks. No package names are hard-coded.

## Severity

The worst of two signals is used: the CVSS score OSV reports for the advisory group (9.0+ Critical,
7.0+ High, 4.0+ Medium) and the advisory's own label. A finding with no usable severity is treated as High.
So an advisory labelled "Moderate" with a CVSS of 7.5 counts as High.

## Scanner failures

osv-scanner exits 0 when clean and 1 when it finds something. Both are judged from the JSON. Any other
exit code, or an empty report, fails the job, so a broken scan can't pass silently.

## Changing the policy

Edit the gate in `ci.yml`. Don't add ignore lists to hide a finding. Fix it by upgrading, which is a
`package.json` change for the architect or backend lane. Open upgrade suggestions are in
`docs/ops/dependency-findings.md`.
