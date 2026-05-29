# Security Policy

## Reporting a vulnerability

If you discover a security issue in Hailfreq, please report it privately. Do **not** open a public GitHub Issue for security-sensitive findings.

### How to report

Email: `hailfreq@pm.me` with the subject line `[hailfreq security]`. Encrypt the report with the project's PGP key if you have it; otherwise plaintext is fine — the email is a private channel.

### What to include

- Affected component (client, server kit, or specific module)
- Affected version(s)
- Reproduction steps (minimal sequence to trigger the issue)
- Impact (what an attacker can do)
- Proof-of-concept code if you have one
- Suggested mitigation if you have one

### What to expect

- **Acknowledgement within 7 days.** If you haven't heard back, follow up.
- **Triage within 14 days.** Confirmation of severity and a rough timeline for a fix.
- **Coordinated disclosure.** We agree on a public-disclosure date before publishing the fix. Default is 90 days from acknowledgement, shorter if the vuln is actively exploited.
- **Credit in the release notes** (if you want it).

## Threat model

Hailfreq is a Tier 3 privacy product. The full threat model is documented in [`docs/superpowers/specs/2026-05-26-hailfreq-design.md`](docs/superpowers/specs/2026-05-26-hailfreq-design.md), §3. Briefly:

- **Server operator is honest-but-curious.** They cannot decrypt voice (SFrame), chat (Megolm), screen shares (SFrame), or attachments (Matrix encryption).
- **Server operator can see metadata.** Membership lists, connection times, room names. If hiding metadata from the operator is your concern, Hailfreq is not the tool for that.
- **Bridge operators see both sides.** A net-bridge operator has both SFrame keys for the bridged pair. This is intrinsic; receivers see an identity attribution suffix.
- **Compromised client = compromised user.** SFrame keys live in client memory.
- **No protection against subpoenas** — server operators receiving valid legal process can hand over what they can see (metadata, ciphertext). We deliberately keep our metadata footprint small to limit this.

## Out of scope

The following are NOT considered security issues for the purposes of this policy:

- Bug reports without exploit potential (use GitHub Issues)
- Reports against unsupported / out-of-scope features (macOS, web client)
- Findings against third-party dependencies for which a patch already exists upstream — please report those upstream first
- Self-XSS / clickjacking that requires the victim to actively cooperate with the attacker
- Findings against the test server's operational posture (server hardening, TLS config, etc.) — those are deployment concerns, report to the operator directly
- Social engineering against project maintainers
- Denial of service via excessive resource consumption against a self-hosted server (the operator is expected to configure rate limits)

## Hall of Fame

Researchers who responsibly disclose are credited here:

_(empty)_
