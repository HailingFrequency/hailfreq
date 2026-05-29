#!/usr/bin/env bash
# Hailfreq end-to-end healthcheck.
# Exits 0 if everything is reachable and healthy, nonzero otherwise.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Create one with HAILFREQ_DOMAIN, HAILFREQ_SERVER_HOSTNAME, HAILFREQ_ADMIN_EMAIL, HAILFREQ_PUBLIC_IP."
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

# Fetch all container records once; supports both docker (newline-delimited JSON objects)
# and podman (JSON array). Filter per service by the compose service label.
PS_JSON=$($COMPOSE ps --format json 2>/dev/null || echo "")

echo "Container health:"
for svc in postgres synapse caddy livekit coturn; do
  status=$(python3 -c '
import sys, json

raw = """'"$PS_JSON"'"""
svc = sys.argv[1]

if not raw.strip():
    print("missing")
    sys.exit()

# Normalise to a list of objects
try:
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    elif not isinstance(data, list):
        data = []
except json.JSONDecodeError:
    # newline-delimited JSON objects (docker compose)
    data = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            try:
                data.append(json.loads(line))
            except json.JSONDecodeError:
                pass

# Find the container for this service
obj = None
for item in data:
    labels = item.get("Labels") or {}
    svc_label = labels.get("com.docker.compose.service") or labels.get("io.podman.compose.service") or ""
    if svc_label == svc:
        obj = item
        break

if obj is None:
    print("missing")
    sys.exit()

# Prefer explicit Health field; fall back to parsing Status string
health = obj.get("Health") or obj.get("health") or ""
if not health:
    status_str = obj.get("Status") or obj.get("status") or ""
    if "(healthy)" in status_str:
        health = "healthy"
    elif "(unhealthy)" in status_str:
        health = "unhealthy"
    elif "(starting)" in status_str:
        health = "starting"
    else:
        health = "none"

print(health)
' "$svc" 2>/dev/null || echo "missing")
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
