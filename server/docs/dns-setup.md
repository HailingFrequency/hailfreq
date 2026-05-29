# DNS Setup for Hailfreq

Hailfreq uses **well-known delegation**: users type the identity domain (e.g., `rpk.chat`), the client looks up `.well-known/matrix/client` to discover the server hostname, then connects to the actual server (e.g., `server.rpk.chat`). User IDs become `@alice:rpk.chat` — clean apex identity, while the underlying server gets its own hostname for SSH/admin clarity.

## Two A records (recommended setup)

Both records point at the **same** VPS public IPv4 address.

```
NAME      TYPE   VALUE              TTL    PROXY (Cloudflare)
@         A      203.0.113.10       300    DNS only (grey cloud)
server    A      203.0.113.10       300    DNS only (grey cloud)
```

(`@` is the zone apex. Substitute `server` with whatever subdomain you chose for `HAILFREQ_SERVER_HOSTNAME` in `.env`.)

## Single-host alternative

If you'd rather skip delegation and run everything from one hostname (user IDs become `@alice:radio.your-domain.com`), set `HAILFREQ_SERVER_HOSTNAME` equal to `HAILFREQ_DOMAIN` in `.env` and add a single A record for that subdomain.

## Per-provider notes

### Cloudflare DNS

1. Add both A records.
2. **Set "Proxy status" to "DNS only" (grey cloud)** for both unless you've read [`cloudflare.md`](cloudflare.md). The orange-cloud proxy mode does not pass WebRTC UDP and will break voice.

### Route 53

Two standard A records. Default TTL is fine.

### Namecheap, GoDaddy, etc.

Two standard A records in the DNS management panel.

## Verifying

```bash
dig +short rpk.chat
dig +short server.rpk.chat
# Both should return your VPS public IP, exactly
```

You can also verify the delegation is working end-to-end once Caddy is up:

```bash
curl -s https://rpk.chat/.well-known/matrix/client
# Expected: {"m.homeserver":{"base_url":"https://server.rpk.chat"}}
```

## .well-known auto-discovery

Synapse handles `.well-known/matrix/client` and `.well-known/matrix/server` via the Caddy reverse proxy. You do **not** need to set up `_matrix._tcp` SRV records — federation is disabled per the Hailfreq design.

## Why two hostnames?

- **User identity is clean.** `@alice:rpk.chat` is shorter and looks more like an email than `@alice:radio.rpk.chat`.
- **SSH is unambiguous.** `ssh user@server.rpk.chat` clearly targets the VPS; nothing about the apex name suggests "this is where the server lives."
- **The apex stays free for a landing page.** You can put a Cloudflare Pages site or a Caddy-served HTML page at the apex later without conflicting with the Matrix delegation (since the delegation only claims `/.well-known/matrix/*`).
- **Server moves are easier.** If you migrate the server to a different host later, you only update the `server.rpk.chat` A record and the `.well-known` JSON — user IDs and existing rooms stay valid because they're keyed on the identity domain.
