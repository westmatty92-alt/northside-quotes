#!/usr/bin/env bash
# Baseleap machine installer v1 (skill: ops-machine).
#
# Turns a fresh always-on Ubuntu 24.04 machine into a Baseleap agent host.
# Run as the agent's normal user (never root); uses sudo only for apt.
#
#   install.sh <machine.json>              full, idempotent install (default)
#   install.sh <machine.json> kit-update   fetch kit, test, switch only on pass
#   install.sh <machine.json> heartbeat    write (and POST) the heartbeat only
#
# Every step checks before it acts and prints "ok" (nothing to do) or
# "changed". Running it twice changes nothing the second time.
#
# This script never reads, stores or prints a secret value. Per-machine values
# live in machine.json (never committed). The owner logs in to Claude Code by
# hand afterwards; the installer prints the command.
set -euo pipefail

# ---- pins (bump in a reviewed change, never at install time) ---------------
NODE_VERSION="22.14.0"            # Node LTS line; tarball verified against nodejs.org SHASUMS256.txt
CLAUDE_CODE_VERSION="2.1.325"     # @anthropic-ai/claude-code — the version proven on the ThinkPad (Nov 15 2026); bump deliberately
DISK_LOW_PCT=10                   # heartbeat reports "disk-low" below this free %

# ---- paths ------------------------------------------------------------------
BL_DIR="$HOME/.baseleap"
BIN_DIR="$BL_DIR/bin"
STATE_DIR="$BL_DIR/state"
LOG_DIR="$BL_DIR/logs"
KIT_DIR="$HOME/baseleap-kit"
HB_FILE="$BL_DIR/heartbeat.json"
UNIT_DIR="$HOME/.config/systemd/user"
INSTALLED_CONFIG="$BL_DIR/machine.json"
INSTALLED_SELF="$BIN_DIR/install.sh"
TEST_STATE="$STATE_DIR/kit-tests"

CHANGED=0
KIT_FAIL=0
CONFIG=""
MODE="install"

# ---- output -----------------------------------------------------------------
ok()      { printf 'ok       %s\n' "$*"; }
changed() { printf 'changed  %s\n' "$*"; CHANGED=$((CHANGED + 1)); }
info()    { printf 'info     %s\n' "$*"; }
skip()    { printf 'skip     %s\n' "$*"; }
warn()    { printf 'warn     %s\n' "$*" >&2; }
die()     { printf 'FAILED   %s\n' "$*" >&2; exit 1; }

usage() {
  printf 'usage: %s <machine.json> [install|kit-update|heartbeat]\n' "$0" >&2
  exit 2
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    die "need root for package install and sudo is not available"
  fi
}

pkg_installed() {
  [ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null || true)" = "installed" ]
}

# cfg <key>: string value from machine.json ("" when absent). Never logged.
cfg() {
  jq -r --arg k "$1" '(.[$k] // "") | if type == "string" then . else tojson end' "$CONFIG"
}

# install_file <src> <dst> <mode> <label>: copy only when content differs.
install_file() {
  local src="$1" dst="$2" mode="$3" label="$4"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    ok "$label"
  else
    install -m "$mode" "$src" "$dst"
    changed "$label"
  fi
}

# ---- machine.json -----------------------------------------------------------
bootstrap_jq() {
  # jq is needed to read machine.json, so it is the one package installed
  # before validation. Everything else waits until the config is accepted.
  if ! pkg_installed jq; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends jq >/dev/null
    changed "bootstrap: jq (needed to read machine.json)"
  fi
}

validate_config() {
  [ -f "$CONFIG" ] || die "machine.json not found: $CONFIG"
  jq -e 'type == "object"' "$CONFIG" >/dev/null 2>&1 || die "machine.json is not a JSON object"

  local missing=() f v
  for f in machine_id operator client_id timezone kit_channel kit_source kit_ref; do
    v="$(jq -r --arg k "$f" '.[$k] | if type == "string" then . else "" end' "$CONFIG")"
    case "$v" in
      "" | "<"*) missing+=("$f") ;;
    esac
  done
  jq -e '(.teams | type == "array" and length > 0 and all(type == "string" and length > 0))' \
    "$CONFIG" >/dev/null 2>&1 || missing+=("teams")
  # heartbeat_url must be present; an empty string means "do not POST".
  jq -e 'has("heartbeat_url") and (.heartbeat_url | type == "string")' \
    "$CONFIG" >/dev/null 2>&1 || missing+=("heartbeat_url")
  v="$(jq -r '.heartbeat_url | if type == "string" then . else "" end' "$CONFIG")"
  case "$v" in "<"*) missing+=("heartbeat_url") ;; esac

  if [ "${#missing[@]}" -gt 0 ]; then
    die "machine.json missing or placeholder required field(s): ${missing[*]}"
  fi

  # No secret-looking keys: machine.json is not a place for credentials.
  if ! jq -e '[paths | map(tostring) | join(".") | select(test("key|token|secret|passw"; "i"))] | length == 0' \
    "$CONFIG" >/dev/null; then
    die "machine.json has a key that looks like a secret; credentials never go in this file"
  fi

  local id ref channel src tz hb
  id="$(cfg machine_id)"; ref="$(cfg kit_ref)"; channel="$(cfg kit_channel)"
  src="$(cfg kit_source)"; tz="$(cfg timezone)"; hb="$(cfg heartbeat_url)"
  [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || die "machine_id may only contain letters, digits, . _ -"
  [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die "kit_ref must be a tag, commit or branch name"
  [[ "$tz" =~ ^[A-Za-z0-9_+/-]+$ ]] || die "timezone has unexpected characters"
  case "$channel" in stable | edge) ;; *) die "kit_channel must be 'stable' or 'edge'" ;; esac
  case "$src" in
    /* | https://* | ssh://* | git://* | file://*) ;;
    *) die "kit_source must be an absolute path (git bundle) or an https/ssh/git URL" ;;
  esac
  if [[ "$src" =~ ://[^/@]*:[^/@]*@ ]]; then
    die "kit_source must not embed credentials (use the owner's git login or a deploy key)"
  fi
  if [ -n "$hb" ]; then
    case "$hb" in https://*) ;; *) die "heartbeat_url must be https:// (or empty to disable)" ;; esac
  fi
  ok "machine.json valid (machine_id=$id)"
}

# ---- steps ------------------------------------------------------------------
ensure_dirs() {
  local d need=0
  for d in "$BL_DIR" "$BIN_DIR" "$STATE_DIR" "$LOG_DIR" "$HOME/.local/bin"; do
    [ -d "$d" ] || need=1
  done
  mkdir -p "$BL_DIR" "$BIN_DIR" "$STATE_DIR" "$LOG_DIR" "$HOME/.local/bin"
  chmod 700 "$BL_DIR" "$STATE_DIR" "$LOG_DIR"
  if [ "$need" -eq 1 ]; then changed "directories (~/.baseleap, ~/.local/bin)"; else ok "directories"; fi
}

ensure_packages() {
  local pkgs=(git curl jq ca-certificates) missing=() p
  for p in "${pkgs[@]}"; do
    pkg_installed "$p" || missing+=("$p")
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    ok "base packages (${pkgs[*]})"
    return 0
  fi
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
  changed "base packages installed: ${missing[*]}"
}

ensure_node() {
  local arch tarball base dir tmp b did=0
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  dir="$HOME/.local/node/v$NODE_VERSION"
  if [ ! -x "$dir/bin/node" ]; then
    tarball="node-v${NODE_VERSION}-linux-${arch}.tar.gz"
    base="https://nodejs.org/dist/v${NODE_VERSION}"
    tmp="$(mktemp -d)"
    curl -fsSL --retry 3 -o "$tmp/$tarball" "$base/$tarball" || die "could not download Node $NODE_VERSION"
    curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" || die "could not download Node checksums"
    if ! (cd "$tmp" && grep -F " $tarball" SHASUMS256.txt | sha256sum -c --status -); then
      rm -rf "$tmp"
      die "Node $NODE_VERSION checksum mismatch; refusing to install"
    fi
    mkdir -p "$dir.partial"
    tar -xzf "$tmp/$tarball" -C "$dir.partial" --strip-components=1
    rm -rf "$dir"
    mv "$dir.partial" "$dir"
    rm -rf "$tmp"
    did=1
  fi
  for b in node npm npx; do
    if [ "$(readlink "$HOME/.local/bin/$b" 2>/dev/null || true)" != "$dir/bin/$b" ]; then
      ln -sfn "$dir/bin/$b" "$HOME/.local/bin/$b"
      did=1
    fi
  done
  if [ "$did" -eq 1 ]; then changed "node v$NODE_VERSION (checksum verified)"; else ok "node v$NODE_VERSION"; fi
}

ensure_claude() {
  local pj="$HOME/.local/lib/node_modules/@anthropic-ai/claude-code/package.json" cur=""
  if [ -f "$pj" ]; then cur="$(jq -r '.version // ""' "$pj")"; fi
  if [ "$cur" = "$CLAUDE_CODE_VERSION" ] && [ -x "$HOME/.local/bin/claude" ]; then
    ok "claude code $CLAUDE_CODE_VERSION"
    return 0
  fi
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund --loglevel=error \
    "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" >/dev/null || die "claude code install failed"
  changed "claude code $CLAUDE_CODE_VERSION (not logged in)"
}

ensure_profile_path() {
  local marker='# baseleap-machine: PATH'
  if grep -qF "$marker" "$HOME/.profile" 2>/dev/null; then
    ok "PATH entry in ~/.profile"
  else
    # shellcheck disable=SC2016  # $HOME/$PATH must stay literal in the profile
    printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n' "$marker" >>"$HOME/.profile"
    changed "PATH entry in ~/.profile"
  fi
}

ensure_local_copies() {
  # The timers run the installer and config from ~/.baseleap, not from the
  # directory the owner happened to unpack them in.
  local self
  self="$(readlink -f "${BASH_SOURCE[0]}")"
  if [ "$self" = "$(readlink -f "$INSTALLED_SELF" 2>/dev/null || true)" ]; then
    ok "installer copy (running from it)"
  else
    install_file "$self" "$INSTALLED_SELF" 755 "installer copy in ~/.baseleap/bin"
  fi
  if [ "$CONFIG" = "$(readlink -f "$INSTALLED_CONFIG" 2>/dev/null || true)" ]; then
    ok "machine.json copy (running from it)"
  else
    install_file "$CONFIG" "$INSTALLED_CONFIG" 600 "machine.json copy in ~/.baseleap"
  fi
}

# ---- kit --------------------------------------------------------------------
write_test_state() {
  local line="$1"
  if [ "$(cat "$TEST_STATE" 2>/dev/null || true)" != "$line" ]; then
    printf '%s\n' "$line" >"$TEST_STATE"
  fi
}

kit_fail() {
  KIT_FAIL=1
  printf 'FAILED   kit: %s\n' "$1" >&2
}

# Resolve kit_ref to a commit. Prints the sha; returns 1 (with a message) if not usable.
resolve_target() {
  local ref c
  ref="$(cfg kit_ref)"
  if c="$(git -C "$KIT_DIR" rev-parse --verify -q "refs/remotes/origin/${ref}^{commit}" 2>/dev/null)"; then
    if [ "$(cfg kit_channel)" = "stable" ]; then
      printf "kit_ref '%s' is a branch; channel 'stable' needs a tag or commit (use 'edge' to follow a branch)\n" "$ref" >&2
      return 1
    fi
    printf '%s\n' "$c"
    return 0
  fi
  if c="$(git -C "$KIT_DIR" rev-parse --verify -q "${ref}^{commit}" 2>/dev/null)"; then
    printf '%s\n' "$c"
    return 0
  fi
  printf "kit_ref '%s' not found in the kit source\n" "$ref" >&2
  return 1
}

# Note: called as a plain command. It never returns non-zero; failures set
# KIT_FAIL via kit_fail and the caller exits non-zero at the end.
kit_sync() {
  local src url_state target current cand log stay

  if [ -e "$KIT_DIR" ] && [ ! -d "$KIT_DIR/.git" ] && [ -n "$(ls -A "$KIT_DIR" 2>/dev/null)" ]; then
    kit_fail "$KIT_DIR exists and is not a kit checkout; move it aside"
    return 0
  fi
  if [ ! -d "$KIT_DIR/.git" ]; then
    git init -q -b main "$KIT_DIR" || { kit_fail "git init failed"; return 0; }
    changed "kit repository initialised in ~/baseleap-kit"
  else
    ok "kit repository present"
  fi

  src="$(cfg kit_source)"
  if [ "${src#/}" != "$src" ] && [ ! -f "$src" ] && [ ! -d "$src" ]; then
    kit_fail "kit_source path does not exist"
    return 0
  fi
  url_state="$(git -C "$KIT_DIR" remote get-url origin 2>/dev/null || true)"
  if [ -z "$url_state" ]; then
    git -C "$KIT_DIR" remote add origin "$src"
    changed "kit remote set"
  elif [ "$url_state" != "$src" ]; then
    git -C "$KIT_DIR" remote set-url origin "$src"
    changed "kit remote updated"
  else
    ok "kit remote"
  fi

  if ! git -C "$KIT_DIR" fetch -q --force --tags origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null; then
    kit_fail "fetch from kit source failed"
    return 0
  fi
  ok "kit source fetched"

  if ! target="$(resolve_target)"; then
    kit_fail "cannot resolve kit_ref"
    return 0
  fi
  current="$(git -C "$KIT_DIR" rev-parse -q --verify HEAD 2>/dev/null || true)"
  if [ "$current" = "$target" ]; then
    ok "kit at ${target:0:12}"
    return 0
  fi

  # Test the candidate in a scratch directory; only switch if it passes.
  cand="$STATE_DIR/kit-candidate"
  log="$LOG_DIR/kit-test-${target:0:12}.log"
  rm -rf "$cand"
  mkdir -p "$cand"
  if ! git -C "$KIT_DIR" archive "$target" | tar -x -C "$cand"; then
    rm -rf "$cand"
    kit_fail "could not unpack candidate ${target:0:12}"
    return 0
  fi
  if [ ! -f "$cand/package.json" ]; then
    rm -rf "$cand"
    write_test_state "fail $target"
    kit_fail "candidate ${target:0:12} has no package.json; cannot run npm test. Staying on ${current:0:12}"
    return 0
  fi
  if (cd "$cand" && CI=1 timeout 900 npm test) >"$log" 2>&1; then
    ok "kit tests passed for ${target:0:12} (log: ${log/#$HOME/\~})"
    tail -n 6 "$log" | sed 's/^/           | /'
    rm -rf "$cand"
    write_test_state "pass $target"
    if ! git -C "$KIT_DIR" checkout -q -f --detach "$target"; then
      kit_fail "checkout of ${target:0:12} failed"
      return 0
    fi
    if [ -z "$current" ]; then
      changed "kit installed at ${target:0:12}"
    else
      changed "kit switched ${current:0:12} -> ${target:0:12}"
    fi
  else
    printf 'FAILED   kit tests failed for %s (last lines of %s):\n' "${target:0:12}" "${log/#$HOME/\~}" >&2
    tail -n 15 "$log" | sed 's/^/           | /' >&2
    rm -rf "$cand"
    write_test_state "fail $target"
    stay="${current:0:12}"
    kit_fail "tests failed; NOT switching. Staying on ${stay:-nothing installed}"
  fi
  return 0
}

# ---- systemd user units -----------------------------------------------------
write_unit() {
  # write_unit <name> reads the unit text from stdin.
  local name="$1" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [ -f "$UNIT_DIR/$name" ] && cmp -s "$tmp" "$UNIT_DIR/$name"; then
    ok "unit $name"
  else
    install -m 644 "$tmp" "$UNIT_DIR/$name"
    UNITS_CHANGED=1
    changed "unit $name"
  fi
  rm -f "$tmp"
}

systemd_user_ready() {
  command -v systemctl >/dev/null 2>&1 \
    && [ -d /run/systemd/system ] \
    && systemctl --user show-environment >/dev/null 2>&1
}

ensure_units() {
  local tz t enabled_any=0
  UNITS_CHANGED=0
  tz="$(cfg timezone)"
  mkdir -p "$UNIT_DIR"

  write_unit baseleap-kit-update.service <<EOF
[Unit]
Description=Baseleap kit update (fetch, test, switch only if tests pass)

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=TZ=$tz
ExecStart=/usr/bin/env bash %h/.baseleap/bin/install.sh %h/.baseleap/machine.json kit-update
EOF

  write_unit baseleap-kit-update.timer <<'EOF'
[Unit]
Description=Daily Baseleap kit update check

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  write_unit baseleap-heartbeat.service <<EOF
[Unit]
Description=Baseleap machine heartbeat

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=TZ=$tz
ExecStart=/usr/bin/env bash %h/.baseleap/bin/install.sh %h/.baseleap/machine.json heartbeat
EOF

  write_unit baseleap-heartbeat.timer <<'EOF'
[Unit]
Description=Baseleap heartbeat every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
EOF

  if systemd_user_ready; then
    if [ "$UNITS_CHANGED" -eq 1 ]; then
      systemctl --user daemon-reload
    fi
    for t in baseleap-kit-update.timer baseleap-heartbeat.timer; do
      if systemctl --user is-enabled -q "$t" 2>/dev/null; then
        ok "timer $t enabled"
      else
        systemctl --user enable --now "$t" >/dev/null 2>&1 || die "could not enable $t"
        changed "timer $t enabled"
        enabled_any=1
      fi
    done
    # Linger lets user timers run after a reboot with nobody logged in.
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" = "yes" ]; then
      ok "linger enabled (timers survive reboot)"
    elif loginctl enable-linger "$USER" 2>/dev/null; then
      changed "linger enabled (timers survive reboot)"
    else
      warn "could not enable linger; run once as root: loginctl enable-linger $USER"
    fi
  else
    skip "no systemd user session here (container?). Units written; on a real machine this would run:"
    skip "  systemctl --user daemon-reload && systemctl --user enable --now baseleap-kit-update.timer baseleap-heartbeat.timer"
    skip "  loginctl enable-linger $USER"
  fi
}

# ---- heartbeat --------------------------------------------------------------
write_heartbeat() {
  local checks=() commit="" kb_free kb_total pct_free state_line now
  [ -x "$HOME/.local/bin/node" ] || checks+=("node-missing")
  [ -x "$HOME/.local/bin/claude" ] || checks+=("claude-missing")
  if [ -d "$KIT_DIR/.git" ]; then
    commit="$(git -C "$KIT_DIR" rev-parse -q --verify HEAD 2>/dev/null || true)"
  fi
  [ -n "$commit" ] || checks+=("kit-missing")
  state_line="$(cat "$TEST_STATE" 2>/dev/null || true)"
  case "$state_line" in fail*) checks+=("kit-tests-failing") ;; esac
  [ -f "$UNIT_DIR/baseleap-kit-update.timer" ] && [ -f "$UNIT_DIR/baseleap-heartbeat.timer" ] || checks+=("units-missing")

  read -r kb_free kb_total < <(df -Pk "$HOME" | awk 'NR==2 {print $4, $2}')
  pct_free=$((kb_free * 100 / kb_total))
  [ "$pct_free" -ge "$DISK_LOW_PCT" ] || checks+=("disk-low")

  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$BL_DIR"
  jq -n \
    --arg machine_id "$(cfg machine_id)" \
    --arg client_id "$(cfg client_id)" \
    --arg kit_commit "$commit" \
    --arg kit_ref "$(cfg kit_ref)" \
    --arg last_run "$now" \
    --argjson kb_free "$kb_free" \
    --argjson pct_free "$pct_free" \
    --argjson checks "$(printf '%s\n' "${checks[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')" \
    '{
       schema: 1,
       machine_id: $machine_id,
       client_id: $client_id,
       kit_commit: (if $kit_commit == "" then null else $kit_commit end),
       kit_ref: $kit_ref,
       last_run: $last_run,
       disk_free_gb: (($kb_free * 10 / 1048576 | floor) / 10),
       disk_free_pct: $pct_free,
       failing_checks: $checks
     }' >"$HB_FILE.tmp"
  chmod 600 "$HB_FILE.tmp"
  mv "$HB_FILE.tmp" "$HB_FILE"
  # The heartbeat is a status report (timestamp changes every run), not
  # configuration, so it is "info", never "changed".
  info "heartbeat written (~/.baseleap/heartbeat.json): kit_commit=${commit:0:12} failing_checks=${#checks[@]}"
}

post_heartbeat() {
  local url code
  url="$(cfg heartbeat_url)"
  if [ -z "$url" ]; then
    skip "heartbeat POST (heartbeat_url is empty)"
    return 0
  fi
  # The URL is never printed (it may carry a path token); only the status is.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
    -H 'Content-Type: application/json' --data-binary "@$HB_FILE" "$url" 2>/dev/null || true)"
  case "$code" in
    2??) info "heartbeat POSTed (HTTP $code)" ;;
    *) warn "heartbeat POST failed (HTTP ${code:-000}); will retry on the next timer run" ;;
  esac
}

# ---- main -------------------------------------------------------------------
main() {
  [ "$#" -ge 1 ] || usage
  CONFIG="$(readlink -f "$1")"
  MODE="${2:-install}"
  case "$MODE" in install | kit-update | heartbeat) ;; *) usage ;; esac

  [ -n "${HOME:-}" ] || die "HOME is not set"
  [ "$(id -u)" -ne 0 ] || die "run as the agent's normal user, not root (sudo is used only for apt)"
  export PATH="$HOME/.local/bin:$PATH"

  if [ "$MODE" = "install" ]; then
    bootstrap_jq
  else
    command -v jq >/dev/null 2>&1 || die "jq missing; run a full install first"
  fi
  validate_config

  case "$MODE" in
    install)
      ensure_dirs
      ensure_packages
      ensure_node
      ensure_claude
      ensure_profile_path
      ensure_local_copies
      kit_sync
      ensure_units
      write_heartbeat
      post_heartbeat
      ;;
    kit-update)
      mkdir -p "$STATE_DIR" "$LOG_DIR"
      kit_sync
      write_heartbeat
      post_heartbeat
      ;;
    heartbeat)
      write_heartbeat
      post_heartbeat
      ;;
  esac

  printf 'summary  %s changed\n' "$CHANGED"
  if [ "$MODE" = "install" ]; then
    printf '\nNext step (owner, by hand; the installer never logs in or stores keys):\n'
    printf '  . ~/.profile && claude      # then sign in with the owner'"'"'s own account\n'
  fi
  if [ "$KIT_FAIL" -ne 0 ]; then
    exit 1
  fi
}

main "$@"
