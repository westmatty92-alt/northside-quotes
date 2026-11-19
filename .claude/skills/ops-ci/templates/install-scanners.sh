#!/usr/bin/env bash
# scripts/install-scanners.sh: TEMPLATE (owned by bl-devops). Installs pinned, checksum-verified scanners into a directory.
# Usage: scripts/install-scanners.sh <dest-dir> [tool ...]   (tools: opengrep gitleaks osv-scanner actionlint shellcheck; default: first three)
# Versions match the ones verified on Matthew's machine (Nov 11 2026). Bump deliberately: version + digest together.
set -euo pipefail
DEST=${1:?destination dir}; shift
TOOLS=("${@:-opengrep gitleaks osv-scanner}"); read -ra TOOLS <<< "${TOOLS[*]}"
mkdir -p "$DEST"; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; cd "$TMP"

OPENGREP_VERSION=1.33.1
OPENGREP_SHA256=46e8133cc490f9f50518061590ce2f6be5a08afaeda034471c0ceda4b3899808   # opengrep_manylinux_x86 (GitHub release digest)
GITLEAKS_VERSION=8.30.1
OSV_VERSION=2.7.1
ACTIONLINT_VERSION=1.7.12
# shellcheck: upstream publishes no checksums file, so the digest is pinned here (from the release asset digest).
SHELLCHECK_VERSION=0.11.0
SHELLCHECK_SHA256=8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198   # shellcheck-v0.11.0.linux.x86_64.tar.xz; GitHub release asset digest, confirmed by download (2026-11-17)

for t in "${TOOLS[@]}"; do
  case "$t" in
    opengrep)
      curl -fsSL -o opengrep "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/opengrep_manylinux_x86"
      echo "${OPENGREP_SHA256}  opengrep" | sha256sum -c - ;;
    gitleaks)
      f="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
      curl -fsSL -O "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${f}"
      curl -fsSL -O "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_checksums.txt"
      grep " ${f}\$" "gitleaks_${GITLEAKS_VERSION}_checksums.txt" | sha256sum -c -
      tar xzf "$f" gitleaks ;;
    osv-scanner)
      curl -fsSL -o osv-scanner_linux_amd64 "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64"
      curl -fsSL -O "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_SHA256SUMS"
      grep " osv-scanner_linux_amd64\$" osv-scanner_SHA256SUMS | sha256sum -c -
      mv osv-scanner_linux_amd64 osv-scanner ;;
    actionlint)
      f="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
      curl -fsSL -O "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${f}"
      curl -fsSL -O "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt"
      grep " ${f}\$" "actionlint_${ACTIONLINT_VERSION}_checksums.txt" | sha256sum -c -
      tar xzf "$f" actionlint ;;
    shellcheck)
      if [[ ! "$SHELLCHECK_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
        echo "shellcheck digest is not pinned yet (see docs/ops/pin-actions.md); refusing to install unverified." >&2; exit 3
      fi
      f="shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz"
      curl -fsSL -O "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/${f}"
      echo "${SHELLCHECK_SHA256}  ${f}" | sha256sum -c -
      tar xJf "$f" --strip-components=1 "shellcheck-v${SHELLCHECK_VERSION}/shellcheck" ;;
    *) echo "unknown tool: $t" >&2; exit 2 ;;
  esac
  install -m 0755 "$t" "$DEST/$t"
done
echo "installed: ${TOOLS[*]} → $DEST"
