#!/usr/bin/env bash
set -euo pipefail
PORT="${OFFERSIGNAL_SMOKE_PORT:-4174}"
python3 -m http.server "$PORT" --directory dist >/tmp/offersignal-smoke.log 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
for _ in {1..20}; do curl -fsS "http://127.0.0.1:$PORT/" >/tmp/offersignal-index.html 2>/dev/null && break; sleep 0.1; done
grep -q 'Check a message' /tmp/offersignal-index.html
curl -fsS "http://127.0.0.1:$PORT/logic.js" | grep -q 'analyzeOffer'
echo "Smoke test passed on http://127.0.0.1:$PORT/"
