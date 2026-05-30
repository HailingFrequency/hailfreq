#!/bin/sh
set -e
echo "→ Rendering turnserver.conf (secret from /run/secrets, host/IP from env)"
SECRET="$(cat /run/secrets/turn_shared_secret)"
sed -e "s|__TURN_SHARED_SECRET__|$SECRET|g" \
    -e "s|__HAILFREQ_PUBLIC_IP__|$HAILFREQ_PUBLIC_IP|g" \
    -e "s|__HAILFREQ_SERVER_HOSTNAME__|$HAILFREQ_SERVER_HOSTNAME|g" \
    /etc/coturn/turnserver.conf.template > /tmp/turnserver.conf
echo "→ Starting coturn"
exec turnserver -c /tmp/turnserver.conf
