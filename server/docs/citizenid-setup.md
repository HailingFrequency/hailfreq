# CitizenID OIDC Setup

Hailfreq supports CitizenID (https://citizenid.space) as a primary login provider. This gives members RSI-verified identity badges.

## 1. Register your server as an integrator

1. Sign in to https://citizenid.space as the server operator.
2. Request an `Integrator` role assignment. (As of mid-2026 this is via the contact form on their docs site; check https://docs.citizenid.space/integrator-guide/ for the current process.)
3. Once approved, create an OAuth2 client in the CitizenID admin panel:
   - **Application type:** Web application
   - **Redirect URI:** `https://YOUR_HAILFREQ_DOMAIN/_synapse/client/oidc/callback`
   - **Scopes:** `openid`, `profile`, `email`, `roles`, `rsi.profile`
4. Copy the `Client ID` and `Client Secret`.

## 2. Configure your Hailfreq server

Edit `server/.env` and set:

```
CITIZENID_CLIENT_ID=<your client id>
CITIZENID_CLIENT_SECRET=<your client secret>
```

Then re-run setup and restart:

```bash
./scripts/setup.sh "$HAILFREQ_DOMAIN" "$HAILFREQ_ADMIN_EMAIL"
docker compose up -d
```

## 3. Test the login flow

1. Open `https://YOUR_HAILFREQ_DOMAIN` in a browser.
2. Use any Matrix client (Element, etc.) configured against your server.
3. Click "Sign in with Citizen iD".
4. Browser redirects to citizenid.space, you authorize, redirect back.
5. On first login, Synapse creates a Matrix account `@cid_<id>:YOUR_DOMAIN`.

## 4. (Optional) Restrict signups to RSI-verified accounts only

The default `attribute_requirements` in `synapse/oidc-citizenid.yaml.snippet` requires the `CitizenId.AccountType.Citizen` role. To require RSI-verified accounts only, change the value to `CitizenId.Status.Verified`.

To allow ANY CitizenID user (no role gating), comment out the entire `attribute_requirements` block.

## 5. Disabling CitizenID

To run with local-account login only, leave `CITIZENID_CLIENT_ID` and `CITIZENID_CLIENT_SECRET` empty in `.env`. The setup script will render an empty `oidc_providers: []` and Synapse will skip OIDC initialization.

## Troubleshooting

- **"OIDC provider citizenid not configured"** — check that `CITIZENID_CLIENT_ID` and `CITIZENID_CLIENT_SECRET` are non-empty in `.env` and that you re-ran `./scripts/setup.sh`.
- **"invalid redirect_uri"** — the redirect URI configured in CitizenID must exactly match `https://YOUR_HAILFREQ_DOMAIN/_synapse/client/oidc/callback` including the trailing slash convention.
- **OIDC discovery fails** — check that your server can reach `https://citizenid.space/.well-known/openid-configuration` from inside the Synapse container: `docker compose exec synapse curl -fSs https://citizenid.space/.well-known/openid-configuration`.
