#!/usr/bin/env bash
# Hailfreq server setup — renders config templates into deployable files.
# Idempotent: safe to re-run after editing .env.
#
# Usage:
#   ./scripts/setup.sh                                  # re-render from existing .env
#   ./scripts/setup.sh DOMAIN EMAIL                     # first-time, single-host setup (DOMAIN serves everything)
#   ./scripts/setup.sh DOMAIN EMAIL SERVER_HOSTNAME     # first-time, well-known delegation (DOMAIN is identity, SERVER_HOSTNAME runs the server)

set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
EMAIL="${2:-}"
SERVER_HOSTNAME="${3:-}"

if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
  # First-time setup — write .env from example, set domain/email
  if [[ ! -f .env ]]; then
    cp .env.example .env
  fi
  # If no separate SERVER_HOSTNAME provided, default to DOMAIN (single-host setup)
  if [[ -z "$SERVER_HOSTNAME" ]]; then
    SERVER_HOSTNAME="$DOMAIN"
  fi
  # Escape sed-replacement metacharacters in user-provided values
  escaped_domain=$(printf '%s' "$DOMAIN" | sed -e 's/[&/\\]/\\&/g')
  escaped_email=$(printf '%s' "$EMAIL" | sed -e 's/[&/\\]/\\&/g')
  escaped_server_hostname=$(printf '%s' "$SERVER_HOSTNAME" | sed -e 's/[&/\\]/\\&/g')
  sed -i.bak "s|^HAILFREQ_DOMAIN=.*|HAILFREQ_DOMAIN=${escaped_domain}|" .env
  sed -i.bak "s|^HAILFREQ_SERVER_HOSTNAME=.*|HAILFREQ_SERVER_HOSTNAME=${escaped_server_hostname}|" .env
  sed -i.bak "s|^HAILFREQ_ADMIN_EMAIL=.*|HAILFREQ_ADMIN_EMAIL=${escaped_email}|" .env
  rm -f .env.bak
fi

if [[ ! -f .env ]]; then
  echo "Error: .env not found."
  echo "Usage:"
  echo "  $0 your-domain.com admin@you.com                       # single-host (apex serves everything)"
  echo "  $0 your-domain.com admin@you.com server.your-domain.com  # well-known delegation (recommended)"
  exit 1
fi

# Generate any missing secrets
./scripts/generate-secrets.sh .env

# Load .env for envsubst
set -a
source .env
set +a

# Backwards compatibility: legacy .env files without HAILFREQ_SERVER_HOSTNAME default it to HAILFREQ_DOMAIN
if [[ -z "${HAILFREQ_SERVER_HOSTNAME:-}" ]]; then
  export HAILFREQ_SERVER_HOSTNAME="${HAILFREQ_DOMAIN}"
  echo "→ HAILFREQ_SERVER_HOSTNAME not set; defaulting to HAILFREQ_DOMAIN (${HAILFREQ_DOMAIN}) for single-host operation"
fi

# Validate required vars
for var in HAILFREQ_DOMAIN HAILFREQ_SERVER_HOSTNAME HAILFREQ_ADMIN_EMAIL HAILFREQ_PUBLIC_IP POSTGRES_PASSWORD \
           SYNAPSE_REGISTRATION_SHARED_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET TURN_SHARED_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: required variable $var is empty in .env"
    exit 1
  fi
done

# Catch the documentation placeholder — operator forgot to set their real IP
if [[ "${HAILFREQ_PUBLIC_IP}" == "203.0.113.10" ]]; then
  echo "Error: HAILFREQ_PUBLIC_IP is still the example value (203.0.113.10)."
  echo "Edit .env and set HAILFREQ_PUBLIC_IP to your VPS's public IPv4 address."
  echo "(Run: curl -s ifconfig.me — to find it.)"
  exit 1
fi

# Compute OIDC providers block — empty if CitizenID not configured
if [[ -n "${CITIZENID_CLIENT_ID:-}" && -n "${CITIZENID_CLIENT_SECRET:-}" ]]; then
  echo "→ CitizenID OIDC: enabled"
  OIDC_PROVIDERS_BLOCK=$(envsubst < synapse/oidc-citizenid.yaml.snippet | sed 's/^/  /')
else
  echo "→ CitizenID OIDC: not configured (local accounts only)"
  OIDC_PROVIDERS_BLOCK="  []"
fi
export OIDC_PROVIDERS_BLOCK

# Render templates
echo "→ Rendering synapse/homeserver.yaml"
envsubst < synapse/homeserver.yaml.template > synapse/homeserver.yaml

echo "→ Rendering Caddyfile"
envsubst < Caddyfile.template > Caddyfile

echo "→ Rendering livekit/livekit.yaml"
envsubst < livekit/livekit.yaml.template > livekit/livekit.yaml

echo "→ Rendering coturn/turnserver.conf"
envsubst < coturn/turnserver.conf.template > coturn/turnserver.conf

# Build the bundled livekit-auth image so podman/docker compose can use it
echo "→ Building livekit-auth image"
docker compose --file compose.yml build livekit-auth 2>&1 | tail -3 || \
  podman compose --file compose.yml build livekit-auth 2>&1 | tail -3

echo ""
echo "Setup complete. Next steps:"
if [[ "${HAILFREQ_DOMAIN}" == "${HAILFREQ_SERVER_HOSTNAME}" ]]; then
  echo "  1. Verify DNS A record for ${HAILFREQ_DOMAIN} points to ${HAILFREQ_PUBLIC_IP}"
else
  echo "  1. Verify both DNS A records point to ${HAILFREQ_PUBLIC_IP}:"
  echo "       - ${HAILFREQ_DOMAIN}        (identity domain, serves .well-known delegation)"
  echo "       - ${HAILFREQ_SERVER_HOSTNAME}  (server hostname, runs Synapse + LiveKit)"
fi
echo "  2. Open firewall ports per docs/deployment.md"
echo "  3. Bring up the stack:     docker compose up -d"
echo "  4. Verify health:          ./scripts/healthcheck.sh"
echo "  5. Create admin user:      ./scripts/create-admin.sh"
