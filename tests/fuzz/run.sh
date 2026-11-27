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

# SEC-25. Hash-locked install. tests/fuzz/requirements.lock must list Schemathesis AND every transitive package with
# exact versions and --hash lines. It does NOT exist yet (it needs pip and the network to generate; see below). While it
# is absent this script falls back to the single top-level pin and says so on every run: the dependencies are then
# floating and unhashed, which is an accepted risk only for as long as the fuzz never gets a secret (run.mjs gives
# Schemathesis an allow-list environment, so it does not).
# To create it, once, on Python 3.12 (the version of the venv), from a directory with a one-line input file
# "schemathesis==4.0.0":  uv pip compile --generate-hashes --python-version 3.12 <input> -o tests/fuzz/requirements.lock
# (or pip-compile --generate-hashes). Commit the result. Never hand-write hashes.
LOCK="tests/fuzz/requirements.lock"
STAMP="$VENV/.lock-sha256"
lock_id="none"
if [ -f "$LOCK" ]; then
  lock_id="$(sha256sum "$LOCK" | cut -d' ' -f1)"
fi

have="$(installed_version "$VENV_BIN")"
stale_lock="no"
if [ -f "$LOCK" ] && [ "$(cat "$STAMP" 2>/dev/null || true)" != "$lock_id" ]; then
  stale_lock="yes"
fi
if [ "$have" != "$SCHEMATHESIS_VERSION" ] || [ "$stale_lock" = "yes" ]; then
  echo "Schemathesis $SCHEMATHESIS_VERSION is not in $VENV as the lock describes (found: ${have:-nothing}, lock changed: $stale_lock); installing it there."
  if ! python3 -m venv --clear "$VENV"; then
    not_run "python3 -m venv $VENV failed (on Debian or Ubuntu the python3-venv package may be missing)."
  fi
  # pip runs with a minimal environment: package build code must not see the shell's credentials either.
  pip_env=(env -i "PATH=$PATH" "HOME=$HOME" "LANG=${LANG:-C.UTF-8}")
  if [ -f "$LOCK" ]; then
    if ! "${pip_env[@]}" "$VENV/bin/python" -m pip install --no-input --disable-pip-version-check --require-hashes --only-binary=:all: --no-deps -r "$LOCK"; then
      not_run "pip install --require-hashes -r $LOCK failed."
    fi
    printf '%s\n' "$lock_id" > "$STAMP"
  else
    if ! "${pip_env[@]}" "$VENV/bin/python" -m pip install --no-input --disable-pip-version-check "schemathesis==$SCHEMATHESIS_VERSION"; then
      not_run "pip install schemathesis==$SCHEMATHESIS_VERSION failed."
    fi
  fi
  have="$(installed_version "$VENV_BIN")"
  if [ "$have" != "$SCHEMATHESIS_VERSION" ]; then
    not_run "after the install, $VENV_BIN reports '${have:-nothing}', not $SCHEMATHESIS_VERSION."
  fi
fi
echo "Schemathesis installed version: $have (pinned $SCHEMATHESIS_VERSION)"
if [ -f "$LOCK" ]; then
  echo "Install source: $LOCK (hash-locked, sha256 $lock_id)."
else
  echo "WARNING: $LOCK does not exist. Only schemathesis==$SCHEMATHESIS_VERSION is pinned; its ~54 dependencies are floating and unhashed (SEC-25, lock not done)." >&2
fi

export SCHEMATHESIS_BIN="$PWD/$VENV_BIN"
export SCHEMATHESIS_PINNED_VERSION="$SCHEMATHESIS_VERSION"
exec node tests/fuzz/run.mjs "$@"
