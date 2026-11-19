#!/usr/bin/env bash
# Secret scan for any job that commits or pushes on its own (auto-sync scripts, bots).
# Call it right before the job's `git commit`; a non-zero exit means: don't commit, alert a human.
# Uses gitleaks from scripts/install-scanners.sh (pinned, checksum-verified).
set -euo pipefail
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed: refusing to auto-commit (run scripts/install-scanners.sh)" >&2
  exit 3
fi
# Scans only what is staged; prints file and rule, never the matched value.
gitleaks git --staged --redact --no-banner --exit-code 1
