# Hostinger Pilot Deployment

This directory contains the concrete deployment package for:

- one Hostinger VPS
- Docker Compose
- LibreChat + Aya + Mongo + Meili
- no public container ports
- optional Cloudflare Tunnel + Cloudflare Access in front

## Architecture

```text
Employee Browser -> Cloudflare Access -> Cloudflare Tunnel -> 127.0.0.1:3080 (LibreChat)
                                                      -> 127.0.0.1:3010 (Aya admin/API)

LibreChat -> Aya MCP over Docker network
Aya -> Blue GraphQL
Aya -> SQLite on disk
LibreChat -> Mongo + Meili
```

If you do not use Cloudflare Tunnel, put the app behind a reverse proxy and HTTPS. Do not expose raw app containers directly.

## VPS Shape

Recommended host for this pilot:

- Hostinger KVM 2
- 2 vCPU
- 8 GB RAM
- 100 GB NVMe

This repo's current stack is light enough for that shape if usage is internal and concurrency is low.

## Files In This Directory

- `docker-compose.yml`
- `env/aya.env.example`
- `env/librechat.env.example`
- `config/librechat.yaml.example`
- `cloudflared/config.yml.example`

## Storage Layout

This Hostinger package uses explicit bind mounts so storage is easy to find and back up.

Persistent data lives under:

- `/srv/aya/aya`
- `/srv/aya/mongodb`
- `/srv/aya/meilisearch`
- `/srv/aya/librechat/uploads`
- `/srv/aya/librechat/logs`
- `/srv/aya/backups`

Aya's SQLite database lives inside `/srv/aya/aya`.

## 1. Provision The VPS

Install on Ubuntu 24.04:

- Docker Engine
- Docker Compose plugin
- `git`
- `curl`

Keep one operator access path to the VPS itself:

- Hostinger VPS browser terminal
- SSH
- Tailscale

## 2. Prepare The Deployment Files

From the Aya repo root on the VPS:

```bash
cd Blue/apps/copilot/deploy/hostinger
sudo mkdir -p /srv/aya/aya /srv/aya/mongodb /srv/aya/meilisearch /srv/aya/librechat/uploads /srv/aya/librechat/logs /srv/aya/backups
sudo chown -R "$USER":"$USER" /srv/aya
cp env/aya.env.example env/aya.env
cp env/librechat.env.example env/librechat.env
cp config/librechat.yaml.example config/librechat.yaml
```

Then replace all placeholder secrets.

Generate LibreChat secrets with:

```bash
openssl rand -hex 32
openssl rand -hex 16
```

Use:

- 64 hex chars for `CREDS_KEY`
- 32 hex chars for `CREDS_IV`
- 64 hex chars for `JWT_SECRET`
- 64 hex chars for `JWT_REFRESH_SECRET`
- 64 hex chars for `MEILI_MASTER_KEY`

## 3. Configure Aya

Edit `deploy/hostinger/env/aya.env` and set:

- `BLUE_AUTH_TOKEN`
- `BLUE_CLIENT_ID`
- `BLUE_COMPANY_ID`
- `ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false`
- `AUTH_BOOTSTRAP_KEY`
- `BLUE_WEBHOOK_PUBLIC_URL`
- `BLUE_WEBHOOK_SECRET`
- `BLUE_GRAPHQL_TIMEOUT_MS=15000`
- `BLUE_INGEST_INTERVAL_MS=300000`
- `WORKSPACE_FULL_RECONCILE_HOURS=4`

Keep:

- `BLUE_WORKSPACE_ID=cmhazc4rl1vkand1eonnmiyjy`

Do not point this production deployment back at the legacy pilot workspace.
Use a dedicated Aya integration/service account for these system-level Blue credentials, not a human employee account.

## 4. Configure LibreChat

Edit `deploy/hostinger/env/librechat.env`:

- set `DOMAIN_CLIENT` and `DOMAIN_SERVER` to the final chat hostname, typically `https://copilot.ayafinancial.com`
- replace all secrets
- set `OPENAI_API_KEY`; the default LibreChat model spec uses OpenAI `gpt-4o-mini`
- set `MONGO_INITDB_ROOT_PASSWORD`, then use the same value in `MONGO_URI` and `LIBRECHAT_MONGO_URI`
- to enable Google login, set `ALLOW_SOCIAL_LOGIN=true`, `ALLOW_SOCIAL_REGISTRATION=true`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`
- register the exact Google redirect URI as `${DOMAIN_SERVER}/oauth/google/callback`; LibreChat does not serve the callback at `/api/auth/oauth/google/callback`

Edit `deploy/hostinger/config/librechat.yaml` if needed.
The checked-in `aya_ops` MCP server key is a LibreChat compatibility identifier for the Aya Copilot connection. It includes per-user `Blue Token ID` and `Blue Token Secret` fields. Employees should save their own Blue personal token once in the Aya Copilot server settings so Blue write actions are attributed to the correct user.

## 5. Bring Up The Stack

If you are upgrading an existing no-auth Mongo volume, there is usually no existing Mongo password. Before restarting the stack with `mongod --auth`, generate one and create the admin user while the old no-auth Mongo container is still running:

```bash
./enable-mongo-auth.sh
```

The script updates `env/librechat.env` and `env/aya.env`, creates the Mongo admin user in the currently running no-auth Mongo container, and prints no secret. New deployments can use the example env files directly after replacing the Mongo password placeholders.

From `deploy/hostinger/`:

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
curl http://127.0.0.1:3010/health
curl -I http://127.0.0.1:3080
```

Expected:

- Aya listens on `127.0.0.1:3010`
- LibreChat listens on `127.0.0.1:3080`
- storage is written into `/srv/aya/`

## 6. Optional Cloudflare Tunnel

If you want the same locked-down posture:

1. install `cloudflared` on the VPS
2. create a tunnel
3. route your hostname to the tunnel
4. point the tunnel at `http://127.0.0.1:3080`

Keep Aya admin behind the same private path or a stricter hostname.

## 7. Backups

Back up at minimum:

- `/srv/aya/aya`
- `/srv/aya/mongodb`
- `/srv/aya/librechat/uploads`
- `/srv/aya/librechat/logs`

Run the checked-in backup wrapper from `deploy/hostinger/`:

```bash
./backup.sh
```

The default target is `/srv/aya/backups/<utc timestamp>/`. Copy those artifacts off the VPS to S3, Cloudflare R2, Backblaze B2, or a managed snapshot target. Restore testing should include at least one SQLite restore and one Mongo archive restore before the system is treated as operationally protected.

For this pilot, nightly backups plus Hostinger VPS snapshots before major changes are enough.

## 8. Notes

- SQLite is file-based and stored inside `/srv/aya/aya`
- this is suitable for a small internal pilot
- if the team outgrows it later, the next move is Postgres/Redis plus split services
- `apps/librechat/docker-compose.yml` is a local development compose file only; production should use this Hostinger bundle or an equivalent hardened production compose.
