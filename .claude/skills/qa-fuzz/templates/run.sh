#!/usr/bin/env bash
# tests/fuzz/run.sh: TEMPLATE (owned by bl-qa). Schemathesis fuzz of the deployed API, staging preview only.
# Usage: BASE_URL=<staging preview> tests/fuzz/run.sh customer staff
# Tokens come from the Playwright setup step (.auth/<role>.token); never hardcoded, never printed.
set -euo pipefail

: "${BASE_URL:?BASE_URL (staging preview URL) is required}"
host=$(node -e 'console.log(new URL(process.argv[1]).host)' "$BASE_URL")
IFS=',' read -ra prod <<< "${PRODUCTION_HOSTS:-}"
for p in "${prod[@]}"; do [[ -n "$p" && "$host" == "$p" ]] && { echo "Refusing to fuzz production ($host)"; exit 3; }; done

roles=("${@:-customer}")
status=0
for role in "${roles[@]}"; do
  token_file=".auth/${role}.token"
  [[ -s "$token_file" ]] || { echo "Missing $token_file (run the Playwright setup project first)"; exit 3; }
  echo "== fuzz as $role"
  uvx schemathesis run docs/openapi.yaml \
    --url "$BASE_URL/api" \
    --header "Authorization: Bearer $(cat "$token_file")" \
    ${VERCEL_AUTOMATION_BYPASS_SECRET:+--header "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"} \
    --checks all \
    --phases examples,coverage,fuzzing,stateful \
    --exclude-path-regex "^/webhooks/" \
    --max-time "${FUZZ_MAX_TIME:-600}" --max-response-time 3 \
    --report junit,har --report-dir "docs/qa-reports/fuzz/$role" \
    || status=1
done
exit $status
