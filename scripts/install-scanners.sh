#!/usr/bin/env bash
# scripts/install-scanners.sh (owned by bl-devops). Installs pinned, checksum-verified scanners.
#
#   bash scripts/install-scanners.sh [--dest DIR] [tool ...]
#
# Tools: actionlint gitleaks opengrep osv-scanner (default: all four).
# Default destination: .baseleap/tools/bin (git-ignored). CI passes --dest "$RUNNER_TEMP/bin".
#
# Every download is checked against a SHA-256 pinned in THIS file before anything is unpacked or installed, so a
# swapped release asset fails closed. To bump a tool: change the version and the digest together, from the
# release's own published checksums file (actionlint_<v>_checksums.txt, gitleaks_<v>_checksums.txt,
# osv-scanner_SHA256SUMS) or, for opengrep, the release asset digest, and re-run this script.
# Pins read from those release files on 2026-11-20 (opengrep: kit pin, verified by running this script).
#
# Idempotent: a tool whose pinned version is already in DEST is left alone. Linux x86_64 only (CI runners and the
# orchestrator machine); any other platform stops with an error instead of installing something unchecked.
set -euo pipefail

ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 # actionlint_1.7.12_linux_amd64.tar.gz
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb # gitleaks_8.30.1_linux_x64.tar.gz
OPENGREP_VERSION=1.33.1
OPENGREP_SHA256=46e8133cc490f9f50518061590ce2f6be5a08afaeda034471c0ceda4b3899808 # opengrep_manylinux_x86
OSV_VERSION=2.7.1
OSV_SHA256=fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8 # osv-scanner_linux_amd64

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$ROOT/.baseleap/tools/bin"
TOOLS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest needs a directory}; shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) TOOLS+=("$1"); shift ;;
  esac
done
if [ ${#TOOLS[@]} -eq 0 ]; then TOOLS=(actionlint gitleaks opengrep osv-scanner); fi

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "install-scanners: only Linux x86_64 digests are pinned (this is $(uname -s)-$(uname -m))." >&2
  exit 3
fi

mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fetch() { curl --fail --silent --show-error --location --retry 3 --retry-delay 2 --output "$2" "$1"; }

verify() { # <sha256> <file>
  echo "$1  $2" | sha256sum --check --status || { echo "install-scanners: checksum mismatch for $2; refusing to install." >&2; exit 4; }
}

installed() { # <tool> <version>: is this exact pinned version already in DEST?
  [ -x "$DEST/$1" ] && [ -f "$DEST/.$1.version" ] && [ "$(cat "$DEST/.$1.version")" = "$2" ]
}

for t in "${TOOLS[@]}"; do
  case "$t" in
    actionlint) version=$ACTIONLINT_VERSION ;;
    gitleaks) version=$GITLEAKS_VERSION ;;
    opengrep) version=$OPENGREP_VERSION ;;
    osv-scanner) version=$OSV_VERSION ;;
    *) echo "unknown tool: $t (actionlint gitleaks opengrep osv-scanner)" >&2; exit 2 ;;
  esac
  if installed "$t" "$version"; then echo "$t $version already installed in $DEST"; continue; fi

  work="$TMP/$t"
  mkdir -p "$work"
  case "$t" in
    actionlint)
      f="actionlint_${version}_linux_amd64.tar.gz"
      fetch "https://github.com/rhysd/actionlint/releases/download/v${version}/${f}" "$work/$f"
      verify "$ACTIONLINT_SHA256" "$work/$f"
      tar -xzf "$work/$f" -C "$work" actionlint ;;
    gitleaks)
      f="gitleaks_${version}_linux_x64.tar.gz"
      fetch "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${f}" "$work/$f"
      verify "$GITLEAKS_SHA256" "$work/$f"
      tar -xzf "$work/$f" -C "$work" gitleaks ;;
    opengrep)
      fetch "https://github.com/opengrep/opengrep/releases/download/v${version}/opengrep_manylinux_x86" "$work/opengrep"
      verify "$OPENGREP_SHA256" "$work/opengrep" ;;
    osv-scanner)
      fetch "https://github.com/google/osv-scanner/releases/download/v${version}/osv-scanner_linux_amd64" "$work/osv-scanner"
      verify "$OSV_SHA256" "$work/osv-scanner" ;;
  esac
  install -m 0755 "$work/$t" "$DEST/$t"
  echo "$version" > "$DEST/.$t.version"
  echo "installed $t $version (sha256 verified) -> $DEST/$t"
done
