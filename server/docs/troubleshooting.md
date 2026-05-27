# Troubleshooting

## Stack won't start

**Symptom:** `docker compose up -d` exits with errors.

Common causes:

- **Missing variables in `.env`.** Re-run `./scripts/setup.sh` — it validates required vars.
- **Port conflicts.** Run `sudo lsof -i :80 -i :443 -i :3478 -i :5349 -i :7881 -i :50000` to find conflicts.
- **Docker not running.** `sudo systemctl status docker`.

## Synapse healthcheck fails

```bash
docker compose logs --tail=100 synapse
```

Look for:

- **"sqlalchemy could not connect"** → Postgres not up yet, or password mismatch in `.env`.
- **"signing.key not found"** → first startup; wait 30s and re-check.
- **"OIDC discovery failed"** → CitizenID unreachable; check `docker compose exec synapse curl https://citizenid.space/.well-known/openid-configuration`.

## Caddy can't get a Let's Encrypt cert

```bash
docker compose logs --tail=100 caddy
```

Most common causes:

- DNS A record not yet propagated. Verify with `dig +short YOUR_DOMAIN`.
- Port 80 not reachable from the public internet. Verify with `curl http://YOUR_DOMAIN/.well-known/acme-challenge/test` from somewhere off the VPS.
- Rate-limited by Let's Encrypt (50 certs per registered domain per week). Wait or use staging mode.

## Voice doesn't work but chat does

This is almost always a firewall/NAT issue with WebRTC.

```bash
# Check that LiveKit is reachable on the host network
curl -fSs http://localhost:7880/ && echo "LiveKit signaling OK"

# Check that UDP ports are open externally (use a tool like https://portchecker.co)
# Required: 3478, 5349, 49152-49999, 50000-50100 — all UDP
```

If members can connect to chat but not voice, it's usually:

- UDP ports blocked at the VPS firewall
- LiveKit's `external_ip` in `livekit.yaml` doesn't match the VPS public IP
- VPS hosting provider blocks WebRTC ports (some shared hosting does this; not an issue at Hetzner/DO/Linode/etc.)

## CitizenID login fails

See "Troubleshooting" in [`citizenid-setup.md`](citizenid-setup.md).

## Members say their messages are unreadable on a new device

This is expected E2E behavior. The member needs to either:

1. Verify the new device from an already-signed-in device (SAS emoji comparison), OR
2. Restore from their Recovery Key.

If they lost both: encrypted history is permanently unrecoverable. This is by design — there is no operator backdoor. Direct them to set up Recovery Key properly on all future devices.
