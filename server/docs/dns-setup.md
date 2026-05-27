# DNS Setup for Hailfreq

Your Hailfreq server needs **one DNS A record** pointing your chosen subdomain at your VPS's public IPv4 address.

## Required record

```
NAME      TYPE   VALUE              TTL
radio     A      203.0.113.10       300
```

(Substitute `radio` with your subdomain choice and `203.0.113.10` with your VPS public IP.)

## Per-provider notes

### Cloudflare DNS

1. Add the A record.
2. **Set "Proxy status" to "DNS only" (grey cloud)** unless you've read [`cloudflare.md`](cloudflare.md). The orange-cloud proxy mode does not pass WebRTC UDP and will break voice.

### Route 53

Standard A record. Default TTL is fine.

### Namecheap, GoDaddy, etc.

Standard A record in the DNS management panel.

## Verifying

```bash
dig +short radio.your-guild.com
# Expected: your VPS public IP, exactly
```

## .well-known auto-discovery

Synapse handles `.well-known/matrix/client` and `.well-known/matrix/server` automatically via Caddy. You do **not** need to set up `_matrix._tcp` SRV records — federation is disabled per the Hailfreq design.
