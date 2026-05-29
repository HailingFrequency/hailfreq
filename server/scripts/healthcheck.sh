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

# Resolve docker or podman compose once
COMPOSE=""
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  COMPOSE="podman compose"
else
  echo "Error: neither 'docker compose' nor 'podman compose' is available"
  exit 1
fi

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "Container health:"
for svc in postgres synapse caddy livekit coturn; do
  status=$($COMPOSE ps --format json "$svc" 2>/dev/null \
    | python3 -c '
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print("missing"); sys.exit()
try:
    data = json.loads(raw)
    # podman compose returns a JSON array; docker compose returns newline-delimited objects
    if isinstance(data, list):
        obj = data[-1] if data else {}
    else:
        obj = data
except json.JSONDecodeError:
    # Fallback: treat as newline-delimited JSON objects
    lines = [l for l in raw.splitlines() if l.strip()]
    try:
        obj = json.loads(lines[-1])
    except Exception:
        print("missing"); sys.exit()
print(obj.get("Health") or obj.get("health") or "none")
' \
    2>/dev/null || echo "missing")
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
