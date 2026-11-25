#!/usr/bin/env bash
# Schemathesis contract fuzz of docs/openapi.yaml against $STAGING_URL/api (the staging preview, with the Vercel bypass
# header). Exits non-zero on any 5xx, any response that breaks the contract, or when Schemathesis cannot run:
#   0 no finding   1 findings   2 setup problem, or a Schemathesis run that did not complete   3 NOT RUN: the install failed
# A failed install is never a pass: this script exits 3 and prints "NOT RUN".
#
# Schemathesis is installed ONCE, pinned to one exact version, into a virtual environment inside the repo
# (.baseleap/tools/venv, git-ignored). Nothing is installed outside it. A different version found in that venv is
# replaced by the pinned one, so every run (and the ledger's) uses the same Schemathesis.
# All the fuzzing, the staging-only guard and the secret redaction are in run.mjs; read its header before changing flags.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# The one pinned version (QA2 ruling, ledger 2026-11-24). Change it here only, and say so in docs/qa-reports/QA2-run.md.
SCHEMATHESIS_VERSION="4.0.0"
VENV=".baseleap/tools/venv"
VENV_BIN="$VENV/bin/schemathesis"

# Prints the x.y.z the given Schemathesis binary reports, or nothing when it is missing or does not run.
installed_version() {
  "$1" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true
}

not_run() {
  echo "NOT RUN: $1" >&2
  echo "No fuzz result exists. This is not a pass." >&2
  exit 3
}

have="$(installed_version "$VENV_BIN")"
if [ "$have" != "$SCHEMATHESIS_VERSION" ]; then
  echo "Schemathesis $SCHEMATHESIS_VERSION is not in $VENV (found: ${have:-nothing}); installing it there."
  if ! python3 -m venv "$VENV"; then
    not_run "python3 -m venv $VENV failed (on Debian or Ubuntu the python3-venv package may be missing)."
  fi
  if ! "$VENV/bin/python" -m pip install --no-input --disable-pip-version-check "schemathesis==$SCHEMATHESIS_VERSION"; then
    not_run "pip install schemathesis==$SCHEMATHESIS_VERSION failed."
  fi
  have="$(installed_version "$VENV_BIN")"
  if [ "$have" != "$SCHEMATHESIS_VERSION" ]; then
    not_run "after the install, $VENV_BIN reports '${have:-nothing}', not $SCHEMATHESIS_VERSION."
  fi
fi
echo "Schemathesis installed version: $have (pinned $SCHEMATHESIS_VERSION)"

export SCHEMATHESIS_BIN="$PWD/$VENV_BIN"
export SCHEMATHESIS_PINNED_VERSION="$SCHEMATHESIS_VERSION"
exec node tests/fuzz/run.mjs "$@"
