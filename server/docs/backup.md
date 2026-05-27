# Backup Strategy

The minimum thing to back up: the Postgres `synapse` database and the `.env` file. Everything else is reproducible from the repo.

## What to back up

| Item                          | Why                                     | Frequency      |
|-------------------------------|-----------------------------------------|----------------|
| `postgres_data` volume        | All Synapse state — users, rooms, messages, keys | Daily         |
| `synapse_data/signing.key`    | Server identity — replacing it invalidates federation and OIDC trust | Once, retain forever |
| `.env` file                   | Secrets — can't be regenerated without re-keying everything | On every change |
| `caddy_data/` volume          | Let's Encrypt certs — regenerable but causes rate-limit pain if lost | Weekly        |

You do NOT need to back up `livekit_data` or `coturn`'s state — both are stateless across restarts.

## Simple daily Postgres dump

Add this to crontab on the VPS:

```bash
0 3 * * * cd /path/to/tactical-radio/server && docker compose exec -T postgres pg_dump -U synapse synapse | gzip > /backups/synapse-$(date +\%Y\%m\%d).sql.gz
```

Then sync `/backups/` to off-VPS storage (S3, Backblaze, your home NAS, etc.).

## Restore

To restore from a dump:

```bash
docker compose down
docker volume rm hailfreq_postgres_data
docker compose up -d postgres
sleep 10
gunzip -c /backups/synapse-YYYYMMDD.sql.gz | docker compose exec -T postgres psql -U synapse synapse
docker compose up -d
```

## What CAN'T be recovered from a backup

End-to-end encrypted message **content** in rooms is encrypted with keys held by members' devices, not by your server. If a member loses all their devices AND their Recovery Key, their encrypted history is unrecoverable — backups of `postgres_data` only restore the ciphertext, not the keys.

This is fundamental to Tier 3 privacy. Document it in your member onboarding.
