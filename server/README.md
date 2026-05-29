# Hailfreq Server Kit

Self-host a privacy-first Matrix homeserver tuned for Hailfreq. Single-VPS docker-compose deployment.

See [`docs/deployment.md`](docs/deployment.md) for the full operator guide.

## Quick start

Two hostnames (recommended — well-known delegation; clean user IDs like `@alice:your-guild.com`, SSH-friendly server hostname):

```bash
./scripts/setup.sh your-guild.com admin@your-guild.com server.your-guild.com
# Edit .env to set HAILFREQ_PUBLIC_IP (your VPS public IPv4)
./scripts/setup.sh        # re-run to render configs with the new IP
docker compose up -d
./scripts/healthcheck.sh
```

Single hostname (apex serves everything; user IDs like `@alice:radio.your-guild.com`):

```bash
./scripts/setup.sh radio.your-guild.com admin@your-guild.com
# ...same as above
```

## Hostname options

| Mode | Identity domain (`HAILFREQ_DOMAIN`) | Server hostname (`HAILFREQ_SERVER_HOSTNAME`) | User IDs |
|---|---|---|---|
| **Well-known delegation (recommended)** | `rpk.chat` (or your apex) | `server.rpk.chat` | `@alice:rpk.chat` |
| Single host | `radio.rpk.chat` | (same — auto-defaulted) | `@alice:radio.rpk.chat` |

Delegation requires **two DNS A records**, both → your VPS IP:
- The identity domain (apex or wherever you point users)
- The server hostname (where Synapse + LiveKit actually run)

Caddy on the VPS handles both hosts. The identity domain serves only `.well-known/matrix/client` and a landing fallback; the server hostname runs the full stack.

See [`docs/dns-setup.md`](docs/dns-setup.md) for the exact records.

## Layout

- `compose.yml` — service definitions
- `Caddyfile` — reverse proxy + TLS (rendered from `Caddyfile.template`)
- `synapse/`, `livekit/`, `coturn/` — per-service config templates
- `livekit-auth/` — token-minting service for LiveKit access
- `scripts/` — setup, secrets, healthcheck, admin bootstrap
- `tests/` — integration tests
- `docs/` — operator documentation
