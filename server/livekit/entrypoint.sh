#!/bin/sh
set -e
echo "→ Rendering livekit.yaml (secrets from /run/secrets, public IP from env)"
KEY="$(cat /run/secrets/livekit_api_key)"
SECRET="$(cat /run/secrets/livekit_api_secret)"
sed -e "s|__LIVEKIT_API_KEY__|$KEY|g" \
    -e "s|__LIVEKIT_API_SECRET__|$SECRET|g" \
    -e "s|__HAILFREQ_PUBLIC_IP__|$HAILFREQ_PUBLIC_IP|g" \
    /etc/livekit.yaml.template > /tmp/livekit.yaml
echo "→ Starting LiveKit"
# Absolute path: the image's binary lives at /livekit-server and is not on the
# PATH seen by this sh entrypoint.
exec /livekit-server --config /tmp/livekit.yaml
