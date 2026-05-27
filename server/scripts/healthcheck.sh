#!/usr/bin/env bash
# Hailfreq end-to-end healthcheck.
# Exits 0 if everything is reachable and healthy, nonzero otherwise.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Run ./scripts/setup.sh first."
  exit 2
fi

source .env

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "Container health:"
for svc in postgres synapse caddy livekit coturn; do
  status=$(docker compose ps --format json "$svc" 2>/dev/null | python3 -c 'import sys,json; d=json.loads(sys.stdin.read() or "{}"); print(d.get("Health","none"))' 2>/dev/null || echo "missing")
  case "$status" in
    healthy|none) pass "$svc ($status)" ;;
    *) fail "$svc ($status)" ;;
  esac
done

echo ""
echo "HTTP reachability:"
curl -fSs "http://localhost:8008/health" >/dev/null 2>&1 && pass "synapse /health (direct)" || fail "synapse /health"
curl -fSs "http://localhost:7880/" >/dev/null 2>&1 && pass "livekit signaling" || fail "livekit signaling"

echo ""
echo "Matrix .well-known discovery:"
curl -fSsI "http://localhost/.well-known/matrix/client" >/dev/null 2>&1 && pass "matrix-client discovery" || fail "matrix-client discovery"

echo ""
echo "Healthcheck passed."
