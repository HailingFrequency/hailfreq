#!/bin/sh
set -e
echo "→ Installing envsubst (gettext-base)"
apt-get update -qq && apt-get install -y --no-install-recommends gettext-base 2>&1 | tail -3
echo "→ Loading secrets from /run/secrets/"
export POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"
export SYNAPSE_REGISTRATION_SHARED_SECRET="$(cat /run/secrets/synapse_registration_shared_secret)"
export SYNAPSE_MACAROON_SECRET="$(cat /run/secrets/synapse_macaroon_secret)"
export SYNAPSE_FORM_SECRET="$(cat /run/secrets/synapse_form_secret)"
export TURN_SHARED_SECRET="$(cat /run/secrets/turn_shared_secret)"
echo "→ Rendering homeserver.yaml from template (HAILFREQ_* from env + secrets)"
# envsubst fills ${HAILFREQ_DOMAIN}/${HAILFREQ_SERVER_HOSTNAME} (service env) and
# the ${SYNAPSE_*}/${POSTGRES_PASSWORD}/${TURN_SHARED_SECRET} exported above.
envsubst < /config/homeserver.yaml.template > /data/homeserver.yaml
cp /config/log.config /data/log.config
# Synapse runs as uid 991 but the data volume is root-owned on a fresh rootless
# deploy → it can't write /data/signing.key. This entrypoint runs as root, so
# chown the data dir to the synapse user (replaces the old setup.sh step).
echo "→ Ensuring /data is owned by synapse (uid 991)"
chown -R 991:991 /data
echo "→ Starting Synapse"
exec /start.py
