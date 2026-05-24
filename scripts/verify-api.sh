#!/usr/bin/env bash
#
# Local Pages-Functions verification:
#   1. Start `wrangler pages dev` in the background (local D1 binding).
#   2. Poll /api/status until ready (up to 60 s).
#   3. curl each endpoint and pretty-print the JSON.
#   4. Stop wrangler.
#
# Use after `npm run migrate:local` + `npm run sync:local` + `npm run scrape:local:all`
# so the local D1 actually has data to read. Run: npm run verify:api

set -uo pipefail

PORT="${PORT:-8788}"
BASE="http://127.0.0.1:${PORT}"
LOG="$(mktemp -t cpuprices-pages-XXXXXX.log)"

cleanup() {
  if [[ -n "${WRANGLER_PID:-}" ]]; then
    kill "${WRANGLER_PID}" 2>/dev/null || true
    wait "${WRANGLER_PID}" 2>/dev/null || true
  fi
  rm -f "${LOG}"
}
trap cleanup EXIT

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    python3 -m json.tool
  fi
}

call() {
  local label="$1"
  local path="$2"
  echo
  echo "================================================================="
  echo "  ${label}"
  echo "  GET ${path}"
  echo "================================================================="
  local body
  body=$(curl -sS -w '\n___HTTP_STATUS=%{http_code}___' "${BASE}${path}")
  local status="${body##*___HTTP_STATUS=}"
  status="${status%%___*}"
  local json="${body%___HTTP_STATUS=*___}"
  echo "HTTP ${status}"
  echo "${json}" | pretty
}

echo "Starting wrangler pages dev on port ${PORT} (logs: ${LOG})..."
npx wrangler pages dev --port "${PORT}" --ip 127.0.0.1 >"${LOG}" 2>&1 &
WRANGLER_PID=$!

# Poll for readiness: wait for ANY HTTP response on /, regardless of status
# (the API can still be 5xx if D1 isn't seeded; that's not a readiness problem).
READY=""
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w '%{http_code}' "${BASE}/" 2>/dev/null | grep -qE '^[1-5][0-9][0-9]$'; then
    READY=1
    break
  fi
  sleep 1
done

if [[ -z "${READY}" ]]; then
  echo "ERROR: wrangler pages dev did not become ready within 60 s. Last log lines:"
  tail -40 "${LOG}"
  exit 1
fi
echo "Ready. Hitting endpoints..."

call "1. Status"                    "/api/status"
call "2. Vendor summary (PassMark)" "/api/passmark/vendor-summary"
call "3. Current prices"            "/api/current-prices"
# Pick the first tracked SKU dynamically so the script doesn't hard-code an ID.
SKU_ID=$(curl -sf "${BASE}/api/current-prices" \
  | (command -v jq >/dev/null 2>&1 \
       && jq -r '.data.rows[0].sku_id' \
       || python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["rows"][0]["sku_id"])'))
call "4. SKU history (sku_id=${SKU_ID})" "/api/sku-history?sku_id=${SKU_ID}"
call "5. Price changes"             "/api/price-changes"
echo
echo "================================================================="
echo "  Negative cases (input validation)"
echo "================================================================="
call "5a. sku-history with no sku_id"   "/api/sku-history"
call "5b. sku-history with bad sku_id"  "/api/sku-history?sku_id=abc"

echo
echo "All endpoints responded. Stopping wrangler..."
