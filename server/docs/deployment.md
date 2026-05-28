# Hailfreq Server Deployment Guide

Set up a Hailfreq server on a single cloud VPS.

## Requirements

- A VPS with public IPv4, **4 vCPU / 8 GB RAM minimum** (Hetzner CCX23 or DigitalOcean 4vCPU/8GB recommended). Static IP required.
- Docker Engine 24+ and the `docker compose` v2 CLI plugin.
- Root or sudo access for firewall configuration.
- A domain name you control (e.g., `radio.your-guild.com`).
- An email address for Let's Encrypt registration.
- (Optional) CitizenID integrator account — see [`citizenid-setup.md`](citizenid-setup.md).

## Step 1 — DNS

Create an `A` record:

```
radio.your-guild.com.   IN   A   <your VPS public IP>
```

See [`dns-setup.md`](dns-setup.md) for details and per-provider notes.

## Step 2 — Firewall

Open the following ports on the VPS firewall:

| Port           | Protocol | Purpose                                |
|----------------|----------|----------------------------------------|
| 80             | TCP      | Caddy (Let's Encrypt HTTP-01 challenge) |
| 443            | TCP      | Caddy (HTTPS — Synapse, LiveKit signaling) |
| 3478           | UDP, TCP | coturn TURN                             |
| 5349           | UDP, TCP | coturn TURN-over-TLS                    |
| 7881           | TCP      | LiveKit TCP fallback for media          |
| 49152–49999    | UDP      | coturn relay ports                      |
| 50000–50100    | UDP      | LiveKit media ports                     |

Example (`ufw`):

```bash
sudo ufw allow 80,443,3478,5349,7881/tcp
sudo ufw allow 3478,5349/udp
sudo ufw allow 49152:49999/udp
sudo ufw allow 50000:50100/udp
```

## Step 3 — Clone and configure

```bash
git clone https://github.com/your-org/tactical-radio.git
cd tactical-radio/server
./scripts/setup.sh radio.your-guild.com admin@your-guild.com
```

The setup script will:

1. Create `.env` from `.env.example` if it doesn't exist.
2. Set `HAILFREQ_DOMAIN` and `HAILFREQ_ADMIN_EMAIL` from the arguments.
3. Generate all internal secrets (Postgres password, Synapse keys, LiveKit API key/secret, TURN shared secret).
4. Render all config templates into their final form.

After it completes, **edit `.env`** to set:

- `HAILFREQ_PUBLIC_IP` — your VPS's public IPv4 (run `curl ifconfig.me` to find it).
- `CITIZENID_CLIENT_ID` and `CITIZENID_CLIENT_SECRET` — leave empty unless you've registered with CitizenID (see [`citizenid-setup.md`](citizenid-setup.md)).

Then re-run setup to re-render templates with the new values:

```bash
./scripts/setup.sh
```

## Step 4 — Bring up the stack

```bash
docker compose up -d
```

First startup takes ~60 seconds for Postgres to initialize and Synapse to generate its signing key.

### livekit-auth — LiveKit token minting service

After Plan 4, the stack includes a `livekit-auth` service that mints LiveKit JWTs for Hailfreq clients. It validates Matrix access tokens against Synapse and confirms room membership before issuing a JWT. Caddy exposes it at `/lk-auth/*`.

**Image build:** Built from `server/livekit-auth/` by the setup script. To force a rebuild: `docker compose build livekit-auth`.

### First-start volume ownership (rootless container runtimes)

If you're using rootless Docker or rootless Podman, the user inside the Synapse container (uid 991) needs write access to the named volume. After the first `docker compose up -d`, if Synapse fails to start with permission errors writing to `/data/signing.key`, fix the ownership:

```bash
# Find the volume's host directory
docker volume inspect hailfreq_synapse_data --format '{{ .Mountpoint }}'
# Chown to uid 991 (rootless: use podman unshare or sudo)
sudo chown -R 991:991 <volume-path>
# OR for rootless podman:
podman unshare chown -R 991:991 <volume-path>
docker compose up -d synapse
```

Standard rootful Docker installations don't typically hit this — the bind mount inherits host ownership.

## Step 5 — Verify health

```bash
./scripts/healthcheck.sh
```

Expected output: all five services healthy, all HTTP endpoints reachable, `.well-known` discovery returning JSON.

If `healthcheck.sh` fails on any service, check logs:

```bash
docker compose logs --tail=50 synapse
docker compose logs --tail=50 caddy
docker compose logs --tail=50 livekit
docker compose logs --tail=50 coturn
```

## Step 6 — Create the first admin user

```bash
./scripts/create-admin.sh youradminusername
```

You'll be prompted for a password. Save it in your password manager.

## Step 7 — Log in via Element

1. Install Element Desktop (https://element.io/download) on your workstation.
2. Click "Sign in".
3. Edit the homeserver field to `https://radio.your-guild.com`.
4. Sign in with your admin username and password.
5. Element will prompt you to set up a Security Key (Recovery Key) — **save this** in your password manager. Without it you cannot recover encrypted messages on a new device.

## Step 8 — Onboard members

Two options:

**Local-account invite:**

```bash
docker compose exec synapse register_new_matrix_user -c /data/homeserver.yaml -u username --no-admin http://localhost:8008
```

Share the username and password with the member out-of-band.

**Token-based registration:**

```bash
# 1. Find your admin access token (Element shows it under Settings → Help & About → "Access Token")
ADMIN_TOKEN="<paste your admin access token>"

# 2. Create a single-use registration token via Synapse admin API
docker compose exec synapse curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uses_allowed": 1}' \
  http://localhost:8008/_synapse/admin/v1/registration_tokens/new
```

The response will include a `token` field — share that value with the member, who enters it when registering via Element.

**CitizenID:** if configured, members just click "Sign in with Citizen iD" on the login screen and an account is auto-created on first login (subject to the `attribute_requirements` configured in `synapse/oidc-citizenid.yaml.snippet`).

## Step 9 — (Optional) Configure Cloudflare

See [`cloudflare.md`](cloudflare.md) for guidance. Important caveat: Cloudflare cannot proxy WebRTC media (voice). Only the HTTP/WebSocket chat surface can be Cloudflare-fronted.

## Updating

```bash
cd tactical-radio/server
git pull
docker compose pull
docker compose up -d
```

Synapse handles schema migrations automatically on startup.

## Backup

See [`backup.md`](backup.md). Minimum daily backup: `postgres_data` volume + `.env` file.

## Troubleshooting

See [`troubleshooting.md`](troubleshooting.md).
