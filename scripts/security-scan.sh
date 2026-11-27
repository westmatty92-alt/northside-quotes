#!/usr/bin/env bash
# scripts/security-scan.sh (owned by bl-security; copied from .claude/skills/sec-appsec/templates/security-scan.sh at SEC1).
# Usage: scripts/security-scan.sh <base-ref> <head-ref> <STEP>
# Writes raw results to .baseleap/reviews/<STEP>/ and a summary line per tool. Never prints secret values.
# Exit: 0 = all tools ran and nothing blocking · 1 = blocking findings · 3 = a required tool is missing (not assessable).
#
# Changes from the template:
# - SEC1 round 1: the OSV policy gate is read from the kit copy that is tracked in git
#   (.claude/skills/sec-appsec/templates/osv-gate.mjs), because scripts/osv-gate.mjs does not exist in this repo and is
#   not bl-security's file. Without this, CI (.github/workflows/ci.yml "Security scan") would fail on any OSV finding,
#   even a dev-only Low, with "Cannot find module".
# - SEC1 "CI scan fix (Release 1)", 2026-11-26:
#   * Runs from the repository root whatever the caller's directory, so every relative path below (.gitleaks.toml,
#     .opengrep/, the OSV gate) resolves the same way locally and in CI's checkout.
#   * Opengrep scans the changed files minus the Baseleap kit (.claude/: templates and deliberately vulnerable rule
#     fixtures) and orchestrator reports (.baseleap/: prose and JSON). Targets are passed as a quoted array, so a path
#     with brackets ([request_id]) is never glob-expanded. Gitleaks still scans both directories.
#   * Opengrep rule self-test: before the real scan, a small fixture repo is written to a temp directory and scanned with
#     THIS project's rules. Every `expect: <rule-id>` line must be flagged with that rule and no other line may be (the
#     comparison of .claude/skills/sec-appsec/tests/check-rules.mjs, inlined: that script first runs
#     `opengrep scan --validate`, which in upstream Semgrep also fetches a registry rule pack). A failure fails the scan:
#     a rule that cannot fire is a false pass, not a pass.
#   * Build output is excluded from the tree scan in .gitleaks.toml (paths), not here; the bundle scan is unchanged.
set -uo pipefail
BASE=${1:?base ref}; HEAD=${2:?head ref}; STEP=${3:?step id}
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git checkout"; exit 3; }
cd "$ROOT" || exit 3
OUT=".baseleap/reviews/$STEP"; mkdir -p "$OUT"
status=0; missing=0
have() { command -v "$1" >/dev/null 2>&1 || { echo "NOT ASSESSABLE: $1 not installed"; missing=1; return 1; }; }
OSV_GATE=".claude/skills/sec-appsec/templates/osv-gate.mjs"

git rev-parse --verify -q "$BASE" >/dev/null && git rev-parse --verify -q "$HEAD" >/dev/null || { echo "bad refs"; exit 3; }
CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE...$HEAD")

# 1. Secrets: commits in the range, the working tree, and the built client bundle.
#    .gitleaks.toml skips node_modules/, .baseleap/tools/ and .next/ except .next/static/ (the bundle, scanned here and by
#    the tree scan); see the comments there.
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
write_rule_fixtures() {
  # $1 = empty directory. Each file mirrors this project's real shapes. "expect: <rule-id>" marks a line that must be
  # flagged; every other line must not be. Keep in step with .opengrep/baseleap.yml.
  local d=$1
  mkdir -p "$d/src/app/api/guarded" "$d/src/app/api/jobs/sweep" "$d/src/app/api/unguarded" "$d/src/app/api/health" \
    "$d/src/app/api/auth/sign-in" "$d/src/app/api/quote-requests/[request_id]/submission" "$d/src/app/api/go" \
    "$d/src/lib/server/services" "$d/tests/helpers"

  # Guarded staff handlers (plain, generic, expression-statement guard) and a 405 constant: no finding.
  cat > "$d/src/app/api/guarded/route.ts" <<'TS'
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';

type Params = { params: Promise<{ request_id: string }> };

export const GET = withApi('GET /api/guarded', async (req, ctx) => {
  const staff = await requireStaff(req);
  return json(ctx, { id: staff.userId });
});

export const PUT = withApi<Params>('PUT /api/guarded/[request_id]', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  return json(ctx, { id: request_id, by: staff.userId });
});

export const PATCH = withApi('PATCH /api/guarded', async (req, ctx) => {
  await requireStaff(req);
  return json(ctx, {});
});

const notAllowed = methodNotAllowed('/api/guarded', ['GET', 'PUT', 'PATCH']);
export const DELETE = notAllowed;
TS

  # A cron handler guarded by isCronRequest: no finding.
  cat > "$d/src/app/api/jobs/sweep/route.ts" <<'TS'
import { isCronRequest } from '@/lib/server/env';
import { ProblemError, json, withApi } from '@/lib/server/http';

export const GET = withApi('GET /api/jobs/sweep', async (req, ctx) => {
  if (!isCronRequest(req.headers.get('authorization'))) throw new ProblemError(401, 'unauthorized');
  return json(ctx, { claimed: 0 });
});
TS

  # The four public operations, unguarded by design: no finding.
  cat > "$d/src/app/api/health/route.ts" <<'TS'
import { json, withApi } from '@/lib/server/http';

export const GET = withApi('GET /api/health', async (_req, ctx) => json(ctx, { status: 'ok' }));
TS
  cat > "$d/src/app/api/auth/sign-in/route.ts" <<'TS'
import { json, withApi } from '@/lib/server/http';

export const POST = withApi('POST /api/auth/sign-in', async (_req, ctx) => json(ctx, { signedIn: false }));
TS
  cat > "$d/src/app/api/quote-requests/route.ts" <<'TS'
import { json, withApi } from '@/lib/server/http';

export const POST = withApi('POST /api/quote-requests', async (req, ctx) => json(ctx, { token: req.headers.get('x-form-token') !== null }, 201));
TS
  cat > "$d/src/app/api/quote-requests/[request_id]/submission/route.ts" <<'TS'
import { json, withApi } from '@/lib/server/http';

type Params = { params: Promise<{ request_id: string }> };

export const POST = withApi<Params>('POST /api/quote-requests/[request_id]/submission', async (_req, ctx, { params }) => {
  const { request_id } = await params;
  return json(ctx, { request_id });
});
TS

  # Unguarded handlers, including a staff operation on a path that also has a public one, and a plain function: findings.
  cat > "$d/src/app/api/unguarded/route.ts" <<'TS'
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, withApi } from '@/lib/server/http';

type Params = { params: Promise<{ request_id: string }> };

export const GET = withApi('GET /api/unguarded', async (req, ctx) => { // expect: baseleap-route-without-auth-guard
  return json(ctx, { url: req.url });
});

export const POST = withApi<Params>('POST /api/unguarded/[request_id]', async (_req, ctx, { params }) => { // expect: baseleap-route-without-auth-guard
  const { request_id } = await params;
  return json(ctx, { id: request_id });
});

export const PUT = withApi('GET /api/quote-requests', async (_req, ctx) => json(ctx, [])); // expect: baseleap-route-without-auth-guard

export async function DELETE(req: Request) { // expect: baseleap-route-without-auth-guard
  await requireStaff(req);
  return new Response(null, { status: 204 });
}
TS

  # Open redirect: the raw `next` fires; the proxy's shape through safeNextPath and a helper does not.
  cat > "$d/src/app/api/go/route.ts" <<'TS'
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/server/auth/next-path';
import { requireStaff } from '@/lib/server/auth/require-staff';
import { withApi } from '@/lib/server/http';

export const GET = withApi('GET /api/go', async (req: NextRequest) => {
  await requireStaff(req);
  return NextResponse.redirect(req.nextUrl.searchParams.get('next')!); // expect: baseleap-open-redirect
});

export const POST = withApi('POST /api/go', async (req: NextRequest) => {
  await requireStaff(req);
  const { searchParams } = req.nextUrl;
  return redirectTo(req, safeNextPath(searchParams.get('next')));
});

function redirectTo(request: NextRequest, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url));
}
TS

  # SSRF and mass assignment: fire in shipped server code, not in test helpers that read API responses.
  cat > "$d/src/lib/server/services/relay.ts" <<'TS'
type Db = { from: (table: string) => { update: (row: object) => Promise<unknown> } };

export async function relay(req: Request): Promise<void> {
  const { callbackUrl } = await req.json();
  await fetch(callbackUrl, { method: 'POST' }); // expect: baseleap-ssrf-fetch-from-request
}

export async function save(req: Request, db: Db): Promise<void> {
  const body = await req.json();
  await db.from('bookings').update({ ...body, status: 'pending' }); // expect: baseleap-request-body-into-write
}
TS
  cat > "$d/tests/helpers/photos.ts" <<'TS'
type Db = { from: (table: string) => { insert: (row: object) => Promise<unknown> } };

export async function openFirstPhoto(res: Response): Promise<Response> {
  const { url } = await res.json();
  return fetch(url);
}

export async function seedJob(db: Db, requestId: string, createdAt?: string): Promise<void> {
  await db.from('ghl_sync_jobs').insert({ request_id: requestId, kind: 'contact_copy', ...(createdAt === undefined ? {} : { created_at: createdAt }) });
}
TS
}

# Compares an opengrep JSON report of the fixtures with their `expect:` markers. Args: <report.json> <fixture dir>.
compare_rule_fixtures() {
  node - "$1" "$2" <<'JS'
const fs = require('fs');
const path = require('path');
const [report, dir] = process.argv.slice(-2);
const out = JSON.parse(fs.readFileSync(report, 'utf8'));
const key = (file, line, id) => `${file}:${line} ${id}`;
const actual = new Set((out.results || []).map((x) => key(x.path.replace(/^\.\//, ''), x.start.line, x.check_id.split('.').pop())));
const expected = new Set();
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    fs.readFileSync(p, 'utf8').split('\n').forEach((text, i) => {
      const m = text.match(/expect:\s*([\w, -]+?)\s*$/);
      if (m) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => expected.add(key(path.relative(dir, p), i + 1, id)));
    });
  }
};
walk(dir);
const errors = (out.errors || []).filter((e) => String(e.level || 'error').toLowerCase() === 'error');
const missed = [...expected].filter((k) => !actual.has(k));
const extra = [...actual].filter((k) => !expected.has(k));
console.log(`expected ${expected.size} · fired ${actual.size} · missed ${missed.length} · unwanted ${extra.length} · engine errors ${errors.length}`);
missed.forEach((k) => console.log(`MISSED   ${k}`));
extra.forEach((k) => console.log(`UNWANTED ${k}`));
errors.forEach((e) => console.log(`ERROR    ${String(e.message || e.type || JSON.stringify(e)).slice(0, 300)}`));
process.exit(missed.length || extra.length || errors.length ? 1 : 0);
JS
}

if have opengrep; then
  # 2a. Rule self-test (needs node, which CI and every Baseleap machine have).
  if command -v node >/dev/null 2>&1; then
    fixtures=$(mktemp -d "${TMPDIR:-/tmp}/baseleap-rules.XXXXXX")
    write_rule_fixtures "$fixtures"
    st_rc=0
    ( cd "$fixtures" && opengrep scan --config "$ROOT/.opengrep/baseleap.yml" --taint-intrafile --no-git-ignore --quiet --json . ) \
      > "$OUT/opengrep-selftest.json" 2> "$OUT/opengrep-selftest.stderr" || st_rc=$?
    if [ "$st_rc" -ne 0 ] || [ ! -s "$OUT/opengrep-selftest.json" ]; then
      echo "opengrep rule self-test: FAILED, opengrep exited $st_rc on the fixtures (invalid rule or flag?) (blocking):"
      tail -n 20 "$OUT/opengrep-selftest.stderr" | sed 's/^/  /'
      status=1
    elif compare_rule_fixtures "$OUT/opengrep-selftest.json" "$fixtures" > "$OUT/opengrep-selftest.txt" 2>&1; then
      echo "opengrep rule self-test: PASS ($(head -n 1 "$OUT/opengrep-selftest.txt"))"
    else
      echo "opengrep rule self-test: FAILED, a rule does not do what .opengrep/baseleap.yml says (blocking):"
      sed 's/^/  /' "$OUT/opengrep-selftest.txt"
      status=1
    fi
    rm -rf "$fixtures"
  else
    echo "opengrep rule self-test: NOT ASSESSABLE (node missing)"; missing=1
  fi

  # 2b. The scan of the changed files.
  TARGETS=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in .claude/*|.baseleap/*) continue ;; esac
    [[ -f "$f" ]] && TARGETS+=("$f")
  done <<< "$CHANGED"
  if [[ ${#TARGETS[@]} -gt 0 ]]; then
    opengrep scan --config .opengrep/baseleap.yml --taint-intrafile --error --quiet --json "${TARGETS[@]}" > "$OUT/opengrep.json" 2>/dev/null || status=1
    echo "opengrep: $(grep -o '"check_id"' "$OUT/opengrep.json" | wc -l | tr -d ' ') finding(s) in ${#TARGETS[@]} changed file(s)"
  else
    echo "opengrep: no changed files outside .claude/ and .baseleap/ in $BASE...$HEAD"
  fi
fi

# 3. Dependencies: known CVEs from the lockfile (all ecosystems) + npm's advisory DB for production deps.
if have osv-scanner; then
  rc=0; osv-scanner scan source --lockfile package-lock.json --format json --output-file "$OUT/osv.json" >/dev/null 2>&1 || rc=$?
  # 0 = clean, 1 = findings (judged by the policy: block shipped High/Critical, warn on dev-only), else scanner failure
  if [ "$rc" -gt 1 ] || [ ! -s "$OUT/osv.json" ]; then echo "osv-scanner: FAILED (exit $rc)"; status=1
  elif [ "$rc" -eq 1 ]; then
    if [ -f "$OSV_GATE" ]; then node "$OSV_GATE" "$OUT/osv.json" || status=1
    else echo "osv-scanner: findings present and $OSV_GATE is missing, so they cannot be judged (blocking)"; status=1; fi
  fi
  echo "osv-scanner: done ($OUT/osv.json)"
fi
if have npm; then
  npm audit --omit=dev --audit-level=high --json > "$OUT/npm-audit.json" 2>/dev/null || status=1
  echo "npm audit (prod, high+): done"
fi
git diff "$BASE...$HEAD" -- package.json package-lock.json > "$OUT/dependency-diff.patch"

[[ $missing -eq 1 && $status -eq 0 ]] && exit 3
exit $status
