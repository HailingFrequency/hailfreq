# Optional: Cloudflare in front of Hailfreq

You can put Cloudflare in front of your Hailfreq server for DDoS protection and to mask member IPs from your origin. **There is a significant caveat:** Cloudflare cannot proxy WebRTC voice traffic on any standard tier.

## What Cloudflare can and cannot proxy

| Traffic                          | Frontable with Cloudflare? | Effect on member IPs |
|----------------------------------|----------------------------|----------------------|
| Synapse chat + control (HTTP/WS) | ✅ Free tier works         | Hidden from origin   |
| LiveKit signaling (WebSocket)    | ✅ Works                   | Hidden from origin   |
| LiveKit media (voice, UDP)       | ❌ Not on standard tiers   | Visible to your SFU  |
| coturn TURN (UDP)                | ❌ Not on standard tiers   | Visible to your TURN |

Cloudflare Tunnels in particular **do not carry UDP**. Cloudflare Spectrum (Enterprise-only) can proxy UDP but is well outside hobbyist budget.

## If you choose to enable Cloudflare proxy mode

1. In your Cloudflare DNS panel, set the proxy status for your A record to **Proxied (orange cloud)**.
2. In Synapse's config, ensure the `x_forwarded: true` setting is on (already enabled in the Hailfreq template).
3. **Do NOT log or forward the `CF-Connecting-IP` header** anywhere — if you do, you've defeated the IP-masking benefit.
4. Voice will still go directly to your VPS public IP. Your members' IPs are visible to your LiveKit SFU and coturn server regardless of Cloudflare.

## Honest trade-off

Putting Cloudflare in front:

- **Adds** Cloudflare itself as a third party with full HTTP plaintext visibility after TLS termination at Cloudflare's edge.
- **Splits** metadata visibility across you + Cloudflare (rather than concentrating it at you alone).

If your privacy threat model is "no single party should see everything," Cloudflare can be a win. If your threat model is "minimize third-party trust," skip it.

## Recommendation for member-side IP privacy

Document for your members: **use a personal VPN** if you want IP privacy. A VPN hides member IPs from you, from Cloudflare (if used), from your TURN server, and from their ISP — single tool that solves the whole problem.
