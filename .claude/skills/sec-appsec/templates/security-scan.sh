#!/usr/bin/env bash
# scripts/security-scan.sh: TEMPLATE (owned by bl-security; CI copy owned by bl-devops).
# Usage: scripts/security-scan.sh <base-ref> <head-ref> <STEP>
# Writes raw results to .baseleap/reviews/<STEP>/ and a summary line per tool. Never prints secret values.
# Exit: 0 = all tools ran and nothing blocking · 1 = blocking findings · 3 = a required tool is missing (not assessable).
set -uo pipefail
BASE=${1:?base ref}; HEAD=${2:?head ref}; STEP=${3:?step id}
OUT=".baseleap/reviews/$STEP"; mkdir -p "$OUT"
status=0; missing=0
have() { command -v "$1" >/dev/null 2>&1 || { echo "NOT ASSESSABLE: $1 not installed"; missing=1; return 1; }; }

git rev-parse --verify -q "$BASE" >/dev/null && git rev-parse --verify -q "$HEAD" >/dev/null || { echo "bad refs"; exit 3; }
CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE...$HEAD")

# 1. Secrets: commits in the range, the working tree, and the built client bundle.
if have gitleaks; then
  gitleaks git --log-opts="$BASE..$HEAD" --config .gitleaks.toml --redact --no-banner \
    --report-format json --report-path "$OUT/gitleaks-history.json" >/dev/null 2>&1 || status=1
  gitleaks dir . --config .gitleaks.toml --redact --no-banner \
    --report-format json --report-path "$OUT/gitleaks-tree.json" >/dev/null 2>&1 || status=1
  if [[ -d .next/static ]]; then
    gitleaks dir .next/static --config .gitleaks.toml --redact --no-banner \
      --report-format json --report-path "$OUT/gitleaks-bundle.json" >/dev/null 2>&1 || status=1
  else
    echo "NOTE: .next/static missing — run 'npm run build' first to scan the client bundle"; missing=1
  fi
  echo "gitleaks: $(cat "$OUT"/gitleaks-*.json 2>/dev/null | grep -c '"RuleID"') finding(s)"
fi

# 2. SAST: Opengrep (LGPL-2.1, Semgrep-compatible) with Baseleap's own rules only. No registry rule packs.
if have opengrep && [[ -n "$CHANGED" ]]; then
  # shellcheck disable=SC2086
  opengrep scan --config .opengrep/baseleap.yml --taint-intrafile --error --quiet --json $CHANGED > "$OUT/opengrep.json" 2>/dev/null || status=1
  echo "opengrep: $(grep -o '"check_id"' "$OUT/opengrep.json" | wc -l | tr -d ' ') finding(s)"
fi

# 3. Dependencies: known CVEs from the lockfile (all ecosystems) + npm's advisory DB for production deps.
if have osv-scanner; then
  rc=0; osv-scanner scan source --lockfile package-lock.json --format json --output-file "$OUT/osv.json" >/dev/null 2>&1 || rc=$?
  # 0 = clean, 1 = findings (judged by the policy: block shipped High/Critical, warn on dev-only), else scanner failure
  if [ "$rc" -gt 1 ] || [ ! -s "$OUT/osv.json" ]; then echo "osv-scanner: FAILED (exit $rc)"; status=1
  elif [ "$rc" -eq 1 ]; then node "$(dirname "$0")/osv-gate.mjs" "$OUT/osv.json" || status=1; fi
  echo "osv-scanner: done ($OUT/osv.json)"
fi
if have npm; then
  npm audit --omit=dev --audit-level=high --json > "$OUT/npm-audit.json" 2>/dev/null || status=1
  echo "npm audit (prod, high+): done"
fi
git diff "$BASE...$HEAD" -- package.json package-lock.json > "$OUT/dependency-diff.patch"

[[ $missing -eq 1 && $status -eq 0 ]] && exit 3
exit $status
