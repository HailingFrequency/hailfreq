# Rootless podman: pasta networking

By default, rootless podman uses `slirp4netns` for the rootless network namespace bridge. We configure it to use `pasta` instead — newer, faster, recommended for podman 4.5+.

## Enable

Per-user config at `~/.config/containers/containers.conf`:

```toml
[network]
default_rootless_network_cmd = "pasta"
```

Then `podman compose down && podman network rm <project-network> && podman compose up -d` to recreate the network and have new containers pick up pasta as the rootless backend.

## What this does and does not fix

**Pasta as the rootless backend** improves connection-tracking performance and reduces overhead vs slirp4netns. Containers communicating with each other via the bridge network are unaffected — same behavior either way.

**Source-IP preservation for externally-published ports** is a separate concern. When you publish a port with `ports: "443:443"`, rootless podman uses a userspace port-forwarder (rootlessport or pasta-port-handler) that SNATs incoming connections to a container-network gateway IP — typically `10.89.0.x`. Caddy/Synapse see this internal IP for every external client, not the real public IP.

This affects:
- Caddy's `client_ip` field in access logs (shows the gateway, not the real client)
- Per-IP rate-limiting at the Caddy/Synapse HTTP layer (treats all external clients as one IP)
- Geo-blocking by IP (not possible without real IPs)

This does **not** affect:
- Synapse's per-user-ID rate limiting (uses Matrix user IDs, works correctly)
- LiveKit's WebRTC handling (UDP traffic; pasta's behavior is different there)
- Hetzner's edge DDoS protection (operates at the network layer, sees real IPs)

## Workarounds (if you actually need real client IPs)

For Hailfreq's typical scale (guild-sized server), the limitation is acceptable. If real client IPs matter for your deployment:

**Option 1: Run Caddy in host network mode.** Switch the `caddy` service in `compose.yml` to `network_mode: host`, then change the reverse_proxy targets from `synapse:8008` etc. to `localhost:8008` and expose those ports on Synapse too. Caveat: this exposes Synapse and livekit-auth on the host's loopback network, which is fine for a single-host deployment but conceptually broader than the bridge-only access.

**Option 2: Switch to rootful podman.** Run podman as root; port-publishing uses kernel-level DNAT which preserves source IPs natively. Loses the security benefits of rootless.

**Option 3: Accept the limitation.** Synapse + Caddy still function fully; only IP-level analytics and rate-limiting are degraded. For Hailfreq specifically, Matrix-level identity rate-limits cover the most important attack surface.

We picked Option 3 for v0.2.

## Verify

```bash
curl -s https://your-domain/_matrix/client/versions > /dev/null
podman logs --tail 5 hailfreq-caddy | grep client_ip
```

Expected (with the limitation): `10.89.0.x` style internal IP. You won't see your real public IP without Option 1 or Option 2 above.
