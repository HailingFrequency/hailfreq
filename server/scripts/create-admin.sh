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

USERNAME="${1:-}"
if [[ -z "$USERNAME" ]]; then
  read -rp "Admin username: " USERNAME
fi

# Verify Synapse is running
if ! docker compose ps --format json synapse | grep -q '"State":"running"'; then
  echo "Error: synapse container is not running. Bring up the stack first: docker compose up -d"
  exit 2
fi

echo "Creating admin user '${USERNAME}' on ${HAILFREQ_DOMAIN}..."
docker compose exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml \
  -u "$USERNAME" \
  -a \
  http://localhost:8008

echo ""
echo "Admin user created. Log in at:"
echo "  https://${HAILFREQ_DOMAIN}"
echo "  Username: @${USERNAME}:${HAILFREQ_DOMAIN}"
