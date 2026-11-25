#!/usr/bin/env bash
# Schemathesis contract fuzz of docs/openapi.yaml against $STAGING_URL/api (the staging preview, with the Vercel bypass
# header). Exits non-zero on any 5xx, any response that breaks the contract, or when Schemathesis cannot run:
#   0 no finding   1 findings   2 setup problem   3 Schemathesis is not installed (NOT a pass)
# All the work, the staging-only guard and the secret redaction are in run.mjs; read its header before changing flags.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec node tests/fuzz/run.mjs "$@"
