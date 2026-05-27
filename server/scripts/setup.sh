#!/usr/bin/env bash
# Hailfreq server setup — renders config templates into deployable files.
# Idempotent: safe to re-run after editing .env.

set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
  # First-time setup — write .env from example, set domain/email
  if [[ ! -f .env ]]; then
    cp .env.example .env
  fi
  sed -i.bak "s|^HAILFREQ_DOMAIN=.*|HAILFREQ_DOMAIN=${DOMAIN}|" .env
  sed -i.bak "s|^HAILFREQ_ADMIN_EMAIL=.*|HAILFREQ_ADMIN_EMAIL=${EMAIL}|" .env
  rm -f .env.bak
fi

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Run: $0 your-domain.com admin@you.com"
  exit 1
fi

# Generate any missing secrets
./scripts/generate-secrets.sh .env

# Load .env for envsubst
set -a
source .env
set +a

# Validate required vars
for var in HAILFREQ_DOMAIN HAILFREQ_ADMIN_EMAIL HAILFREQ_PUBLIC_IP POSTGRES_PASSWORD \
           SYNAPSE_REGISTRATION_SHARED_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET TURN_SHARED_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: required variable $var is empty in .env"
    exit 1
  fi
done

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

echo ""
echo "Setup complete. Next steps:"
echo "  1. Verify your DNS A record for ${HAILFREQ_DOMAIN} points to ${HAILFREQ_PUBLIC_IP}"
echo "  2. Open firewall ports per docs/deployment.md"
echo "  3. Bring up the stack:     docker compose up -d"
echo "  4. Verify health:          ./scripts/healthcheck.sh"
echo "  5. Create admin user:      ./scripts/create-admin.sh"
