# Hailfreq Server Kit

Self-host a privacy-first Matrix homeserver tuned for Hailfreq. Single-VPS docker-compose deployment.

See [`docs/deployment.md`](docs/deployment.md) for the full operator guide.

## Quick start

```bash
./scripts/setup.sh radio.your-guild.com admin@your-guild.com
# Edit .env to set HAILFREQ_PUBLIC_IP (your VPS public IPv4)
./scripts/setup.sh        # re-run to render configs with the new IP
docker compose up -d
./scripts/healthcheck.sh
```

## Layout

- `compose.yml` — service definitions
- `Caddyfile` — reverse proxy + TLS
- `synapse/`, `livekit/`, `coturn/` — per-service config templates
- `livekit-auth/` — Token-minting service for LiveKit access
- `scripts/` — setup, secrets, healthcheck, admin bootstrap
- `tests/` — integration tests
- `docs/` — operator documentation
