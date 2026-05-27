# Hailfreq Server Kit

Self-host a privacy-first Matrix homeserver tuned for Hailfreq. Single-VPS docker-compose deployment.

See [`docs/deployment.md`](docs/deployment.md) for the full operator guide.

## Quick start

```bash
cp .env.example .env
./scripts/generate-secrets.sh
./scripts/setup.sh your-domain.com admin@you.com
docker compose up -d
./scripts/healthcheck.sh
```

## Layout

- `compose.yml` — service definitions
- `Caddyfile` — reverse proxy + TLS
- `synapse/`, `livekit/`, `coturn/` — per-service config templates
- `scripts/` — setup, secrets, healthcheck, admin bootstrap
- `tests/` — integration tests
- `docs/` — operator documentation
