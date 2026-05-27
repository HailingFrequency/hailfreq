# Updating Hailfreq Server

```bash
cd tactical-radio/server
git pull
docker compose pull
docker compose up -d
```

## What happens

- Synapse runs database migrations automatically on startup.
- Caddy reloads its config without dropping connections.
- LiveKit and coturn restart with zero-downtime if running multi-node (not relevant for single-VPS).

## Pinning versions

The `compose.yml` pins major versions of every image. To upgrade Synapse from `v1.122.0` to a newer release, edit `compose.yml` and bump the tag, then `docker compose pull && docker compose up -d`.

Always check Synapse upgrade notes before upgrading: https://element-hq.github.io/synapse/latest/upgrade.html

## Backup before upgrading

Always take a fresh Postgres dump before any version upgrade. See [`backup.md`](backup.md).
