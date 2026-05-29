#!/usr/bin/env bash
# Create the first admin user on the Hailfreq Synapse server.
# Uses Synapse's register_new_matrix_user CLI (preferred over admin API for first user).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Error: .env not found."
  exit 1
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

USERNAME="${1:-}"
if [[ -z "$USERNAME" ]]; then
  read -rp "Admin username: " USERNAME
fi

# Verify Synapse is running
if ! $COMPOSE ps --format json synapse 2>/dev/null | python3 -c '
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(1)
try:
    data = json.loads(raw)
    if isinstance(data, list):
        obj = data[-1] if data else {}
    else:
        obj = data
except json.JSONDecodeError:
    lines = [l for l in raw.splitlines() if l.strip()]
    try:
        obj = json.loads(lines[-1])
    except Exception:
        sys.exit(1)
state = obj.get("State") or obj.get("state") or ""
sys.exit(0 if state == "running" else 1)
' 2>/dev/null; then
  echo "Error: synapse container is not running. Bring up the stack first: $COMPOSE up -d"
  exit 2
fi

echo "Creating admin user '${USERNAME}' on ${HAILFREQ_DOMAIN}..."
$COMPOSE exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml \
  -u "$USERNAME" \
  -a \
  http://localhost:8008

echo ""
echo "Admin user created. Log in at:"
echo "  https://${HAILFREQ_DOMAIN}"
echo "  Username: @${USERNAME}:${HAILFREQ_DOMAIN}"
