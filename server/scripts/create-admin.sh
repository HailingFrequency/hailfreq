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

# Verify Synapse is running.
# docker compose ps accepts a service-name arg; podman compose ps does not,
# so fetch all containers and filter by the compose service label.
PS_JSON=$($COMPOSE ps --format json 2>/dev/null || echo "")
if ! python3 -c '
import sys, json

raw = """'"$PS_JSON"'"""

if not raw.strip():
    sys.exit(1)

try:
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    elif not isinstance(data, list):
        data = []
except json.JSONDecodeError:
    data = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            try:
                data.append(json.loads(line))
            except json.JSONDecodeError:
                pass

for item in data:
    labels = item.get("Labels") or {}
    svc_label = labels.get("com.docker.compose.service") or labels.get("io.podman.compose.service") or ""
    if svc_label == "synapse":
        state = item.get("State") or item.get("state") or ""
        sys.exit(0 if state == "running" else 1)

sys.exit(1)
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
