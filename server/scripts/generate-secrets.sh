#!/usr/bin/env bash
# Generates secure random secrets and writes them into .env.
# Idempotent: only fills empty values; preserves user-set ones.

set -euo pipefail

ENV_FILE="${1:-.env}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required but not found in PATH."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Run: cp .env.example .env"
  exit 1
fi

generate_secret() {
  # 64 hex chars (256 bits)
  openssl rand -hex 32
}

generate_apikey() {
  # LiveKit recommends 12+ char alphanumeric API key
  openssl rand -hex 12
}

set_if_empty() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=$" "$ENV_FILE"; then
    # Empty -> fill
    # Escape sed-replacement metacharacters
    local escaped_value
    escaped_value=$(printf '%s' "$value" | sed -e 's/[&/\\]/\\&/g')
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^${key}=$|${key}=${escaped_value}|" "$ENV_FILE"
    else
      sed -i "s|^${key}=$|${key}=${escaped_value}|" "$ENV_FILE"
    fi
    echo "  set: $key"
  else
    echo "  skip: $key (already set)"
  fi
}

echo "Generating secrets in $ENV_FILE..."
set_if_empty POSTGRES_PASSWORD "$(generate_secret)"
set_if_empty SYNAPSE_REGISTRATION_SHARED_SECRET "$(generate_secret)"
set_if_empty SYNAPSE_MACAROON_SECRET "$(generate_secret)"
set_if_empty SYNAPSE_FORM_SECRET "$(generate_secret)"
set_if_empty LIVEKIT_API_KEY "$(generate_apikey)"
set_if_empty LIVEKIT_API_SECRET "$(generate_secret)"
set_if_empty TURN_SHARED_SECRET "$(generate_secret)"
echo "Done. Verify with: grep -E '^[A-Z_]+=$' $ENV_FILE  (should show CITIZENID_CLIENT_ID= and CITIZENID_CLIENT_SECRET= if those aren't configured yet)"
