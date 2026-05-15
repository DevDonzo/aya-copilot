# Aya Financial Blue Deployment Guide

This guide documents a practical deployment approach for Aya Financial's Blue platform.

The target operating model is intentionally simple:

- Aya Financial is a small team of roughly 10 people.
- The goal is a reliable internal system, not an overbuilt cloud platform.
- The preferred deployment is one VM, Docker Compose, persistent volumes, and Cloudflare in front.
- The standard is "works consistently, is easy to recover, and is cheap to run."

This is a good fit for an internal pilot or steady-state small-team deployment.

## Deployment Philosophy

For this project, "good" deployment means:

- low monthly cost
- minimal moving parts
- no public app ports
- clear operator access to the VM
- persistent data volumes
- restartable services
- a short recovery path if the VM or containers fail

For this project, "good" does not require:

- Kubernetes
- managed databases
- autoscaling
- complex service meshes
- multi-region failover
- expensive observability tooling

Those would add cost and operational overhead without meaningfully improving outcomes for a team this size.

## Recommended Topology

Use one Hostinger VPS running Docker Compose, with Cloudflare Tunnel and Cloudflare Access in front of the application.

Traffic flow:

```text
Employee Browser
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> 127.0.0.1:3080 (LibreChat)
  -> 127.0.0.1:3010 (Aya admin/API)

LibreChat
  -> Aya MCP server over Docker network

Aya
  -> Blue GraphQL
  -> SQLite persistent volume

LibreChat
  -> MongoDB
  -> Meilisearch
```

Important behavior in the current compose stack:

- app ports are bound to `127.0.0.1`, not `0.0.0.0`
- `cloudflared` runs on the host and proxies to localhost
- containers restart automatically with `restart: unless-stopped`
- Aya includes a health check on `/health`
- application and database state is stored in bind-mounted folders on disk
- LibreChat is the employee shell, while Aya is the backend service boundary for business logic, audit, and Blue integration

## Recommended VPS

For Aya Financial's current size, the existing target is reasonable:

- Hostinger KVM 2
- 2 vCPU
- 8 GB RAM
- 100 GB NVMe
- Ubuntu 24.04

Why this is enough:

- the user base is small
- traffic is internal and low concurrency
- Docker Compose keeps operations simple
- SQLite is acceptable for Aya's local operational state at this scale

If the team grows materially, the first likely pressure points are RAM usage and storage growth, not architectural limits.

## What This Setup Is Good For

This deployment is appropriate for:

- internal staff use
- a pilot with a controlled user group
- a small production workload with limited concurrency
- cost-sensitive operations where simplicity matters more than theoretical scale

This deployment is not designed to guarantee:

- formal high availability
- zero-downtime upgrades
- multi-node redundancy
- disaster recovery across multiple regions

It is better described as reliable and practical for a small team, not "enterprise HA."

## Source Of Truth

The deployment assets already live here:

- `Blue/apps/copilot/deploy/hostinger/docker-compose.yml`
- `Blue/apps/copilot/deploy/hostinger/env/aya.env.example`
- `Blue/apps/copilot/deploy/hostinger/env/librechat.env.example`
- `Blue/apps/copilot/deploy/hostinger/config/librechat.yaml.example`
- `Blue/apps/copilot/deploy/hostinger/cloudflared/config.yml.example`

This guide should match those files. If the compose stack changes, update this document with it.

## Production Workspace Cutover

The current safe workspace is a pilot workspace. In production, Aya should point at the real Blue workspace that contains the real employee membership and real client files.

The cutover is not just "change the workspace ID and keep everything else."

Recommended production cutover:

1. Set `BLUE_WORKSPACE_ID` to the real production workspace ID.
2. Use fresh Aya application data for the first production boot.
3. Prefer a fresh LibreChat Mongo volume for production as well.
4. Boot the stack.
5. Let Aya run its startup syncs.
6. Provision the first admin against the newly synced employee directory.
7. Run the post-deploy smoke test before opening access to everyone.

Why use fresh data:

- Aya stores a local employee directory, identity links, workspace search cache, sync state, and audit/activity data.
- If the old pilot workspace data is reused, names, identities, and cached records can remain mixed with the wrong workspace.

In practice, a clean production cutover should treat the pilot workspace and the production workspace as separate Aya environments.

## What Gets Ingested On First Boot

Aya performs three different local syncs. These are not duplicates of Blue. They are Aya's local read model.

1. Employee sync

- Source: Blue workspace members for `BLUE_WORKSPACE_ID`
- Code: [users-sync.ts](../apps/copilot/src/blue/users-sync.ts)
- Purpose:
  - create Aya's local employee directory
  - create identity links
  - allow auth, role assignment, attribution, and admin reporting

2. Workspace index sync

- Source: Blue lists and records for `BLUE_WORKSPACE_ID`
- Code: [workspace-index.ts](../apps/copilot/src/blue/workspace-index.ts)
- Purpose:
  - fast search by client name, email, phone, and stage
  - disambiguation and follow-up context
  - low-latency routing without hitting Blue for every fuzzy lookup

3. Activity ingest

- Source: Blue activity feed for `BLUE_WORKSPACE_ID`
- Code: [blue-ingest.ts](../apps/copilot/src/activity/blue-ingest.ts)
- Purpose:
  - normalized local activity history
  - employee/admin reporting
  - timeline and audit-style questions over time ranges

These syncs start automatically on boot in [server.ts](../apps/copilot/src/server.ts) and continue via polling in [blue-poller.ts](../apps/copilot/src/jobs/blue-poller.ts).

So the answer to "why sync if Blue already has the data?" is:

- Blue is the system of record.
- Aya keeps a local operational read model so chat feels fast, context-aware, attributable, and reportable.

Without that local read model:

- search gets slower and more brittle
- follow-up context gets weaker
- admin reporting becomes much harder
- every request depends on fresh multi-step Blue reads

## Manual Sync vs Automatic Sync

Manual sync is not the normal operating model.

Normal operation:

- Aya syncs employees on startup
- Aya syncs the workspace index on startup
- Aya polls for index/activity updates on an interval
- webhooks can also push changes in when configured
- specific client/file reads should prefer live Blue data or webhook-fresh cache when freshness matters

Manual sync is for:

- first-time backfill
- recovery after configuration changes
- rehydrating after downtime
- debugging stale cache situations

Admin-only manual sync routes exist here:

- [sync.ts](../apps/copilot/src/routes/sync.ts)

That means production does not depend on an operator clicking "sync" all day. The manual routes are recovery tools, not the main architecture.

## Employee Membership Requirement

Aya only syncs employees from the configured Blue workspace membership.

That means:

- if the production workspace contains all employees, Aya will ingest all of them automatically
- if the workspace only contains a subset of employees, Aya will only know about that subset

This is why the real production workspace matters so much. Aya auth and attribution depend on the workspace membership it can see.

## Blank Email Risk

In the current allowed workspace, Blue user emails are coming back blank from the workspace user query.

That is not ideal.

Why it matters:

- email is the cleanest key for matching LibreChat users to Aya employees
- blank emails force Aya to rely more on display-name matching
- name-only matching is weaker for production identity resolution

Likely causes:

- the Blue workspace user data does not have emails populated for that workspace membership view
- or the current Blue API/token scope does not expose them in this query

The query Aya uses already requests `email` in [client.ts](../apps/copilot/src/modules/blue/graphql/client.ts), so this is not because Aya forgot to ask for it.

Production recommendation:

1. Test the real production workspace membership response before cutover.
2. Confirm whether `projectUserList.users.email` is populated there.
3. If it is populated, use email-based identity resolution normally.
4. If it is blank there too, plan for one of these:
   - manual identity linking
   - stricter name-based onboarding
   - an alternate employee directory source for email mapping

Blank emails are survivable, but they are not the ideal production identity setup.

## Blue Write Attribution

Today, Aya supports two write modes:

1. Personal Blue credentials per employee

- employee supplies Blue Token ID + Secret once
- LibreChat stores them encrypted
- Aya uses them for employee-triggered write actions
- Blue attributes the write to the real employee

2. System fallback

- Aya uses the system credential when fallback is enabled
- writes still happen
- Blue may not attribute the write to the real employee in Blue itself

Current code:

- request auth normalization: [request-auth.ts](../apps/copilot/src/modules/blue/request-auth.ts)

Recommended production policy:

- keep system fallback disabled for production writes unless there is a deliberate exception
- require personal Blue credentials for employee-triggered writes that must show up in Blue as that employee

## Do Employees Have To Paste API Keys?

For strict Blue-side per-user attribution, some form of per-user Blue credential is required unless Blue supports delegated OAuth or another server-side impersonation flow.

The current implementation uses personal Blue Token ID + Secret because it is the cleanest working path available in this codebase.

The product problem is not the credential requirement itself. The problem is the UX.

The better production UX is:

- employee signs into Aya
- Aya detects they are not connected for writes yet
- Aya shows a simple "Connect Blue" settings flow
- employee pastes Token ID + Secret once
- Aya stores them encrypted
- all future writes work normally

That is better than exposing raw MCP settings as the main onboarding path.

So:

- no, I would not keep "open MCP settings and paste keys" as the long-term product UX
- yes, I would keep personal Blue credentials underneath if Blue attribution is required and Blue does not offer a better delegated auth model

## First Production Admin Setup

Once the production workspace employees are synced:

1. confirm `AYA_LIBRECHAT_ADMIN_EMAILS` includes the intended LibreChat admins before they register
2. provision one synced employee as Aya `admin` before locking down production access
3. log into Aya with that employee and use the existing admin session to provision additional Aya admins
4. confirm each admin can ask `who am I signed in as?` and receives role `admin`

The bootstrap route is intentionally disabled in production. Do not set `ALLOW_BOOTSTRAP_PROVISIONING=true` in production. If the first production admin is missing, use a controlled maintenance operation against the Aya database or temporarily perform provisioning before starting with `NODE_ENV=production`.

Provisioning code:

- [auth.ts](../apps/copilot/src/routes/auth.ts)
- [service.ts](../apps/copilot/src/auth/service.ts)

## Services In The Stack

The current Hostinger deployment includes:

- `aya`: Aya ops bot, MCP surface, admin/API layer
- `librechat`: employee-facing chat interface
- `mongodb`: LibreChat persistence
- `meilisearch`: LibreChat search dependency

Persistent storage directories:

- `/srv/aya/aya`
- `/srv/aya/mongodb`
- `/srv/aya/meilisearch`
- `/srv/aya/librechat/uploads`
- `/srv/aya/librechat/logs`
- `/srv/aya/backups`

## Prerequisites

Before deployment, have the following ready:

- a Hostinger VPS with Ubuntu 24.04
- Docker Engine installed
- Docker Compose plugin installed
- `git` and `curl`
- a Cloudflare account with the Aya domain managed there
- `copilot.ayafinancial.com`
- Blue API credentials for the allowed Aya workspace only
- an operator access path to the VM

Operator access should be one of:

- Hostinger browser terminal
- Tailscale
- a tightly restricted SSH path

Do not confuse "no public app ports" with "no operator access."

## Security Posture

The baseline security model is intentionally simple:

- do not expose LibreChat or Aya directly on public ports
- bind app services to localhost only
- put Cloudflare Tunnel in front of the app
- require Cloudflare Access before users reach the login page
- keep secrets in env files on the VM, not in the repo
- keep the pilot scoped to the approved Blue workspace only

For a small team, this gives strong practical protection without adding expensive infrastructure.

## Deployment Steps

### 1. Provision The VM

Create the Hostinger VPS with the recommended size above.

Basic host setup:

- update packages
- install Docker Engine and Docker Compose plugin
- install `git` and `curl`
- configure timezone if needed
- confirm you can reconnect through your chosen admin path

### 2. Pull The Repo

Clone the Aya Financial repository onto the VM and navigate to:

```bash
cd Blue/apps/copilot/deploy/hostinger
```

### 3. Prepare Configuration

Copy the example files:

```bash
cp env/aya.env.example env/aya.env
cp env/librechat.env.example env/librechat.env
cp config/librechat.yaml.example config/librechat.yaml
```

Create the storage folders before first boot:

```bash
sudo mkdir -p /srv/aya/aya /srv/aya/mongodb /srv/aya/meilisearch /srv/aya/librechat/uploads /srv/aya/librechat/logs /srv/aya/backups
sudo chown -R "$USER":"$USER" /srv/aya
```

If using the Cloudflare template, also prepare:

```bash
cp cloudflared/config.yml.example /etc/cloudflared/config.yml
```

### 4. Configure Aya

Edit `env/aya.env` and set:

- `BLUE_AUTH_TOKEN`
- `BLUE_CLIENT_ID`
- `BLUE_COMPANY_ID`
- `AUTH_BOOTSTRAP_KEY`
- `BLUE_WEBHOOK_PUBLIC_URL`
- `BLUE_WEBHOOK_SECRET`
- `BLUE_GRAPHQL_TIMEOUT_MS=15000`
- `BLUE_INGEST_INTERVAL_MS=300000`
- `WORKSPACE_FULL_RECONCILE_HOURS=4`
- `OPENAI_API_KEY`
- `AYA_CHAT_RUNTIME`
- `AYA_AGENT_MODEL`
- `AYA_AGENT_MAX_STEPS`
- `AYA_AGENT_TIMEOUT_MS`

Keep the deployment constrained to the approved workspace:

- `BLUE_WORKSPACE_ID=cmhazc4rl1vkand1eonnmiyjy`

Recommended chat runtime rollout:

- `AYA_CHAT_RUNTIME=agent_with_planner_fallback`
- keep `AYA_AGENT_MAX_STEPS=5`
- use `AYA_AGENT_TIMEOUT_MS=30000` unless production logs show a specific need to tune it
- set `AYA_CHAT_RUNTIME=planner` for immediate rollback to the deterministic planner

Operational note:

- do not point this production deployment back at the legacy pilot workspace
- do not commit populated env files back into source control
- Blue returns a webhook signing secret only when a webhook is created. If production has an enabled webhook but no stored `BLUE_WEBHOOK_SECRET` or `blue_webhook_subscriptions.secret_ref`, the app recreates the webhook on startup and stores the new secret.
- A healthy webhook means Blue accepted the registration health check. Verify actual event delivery separately by creating a safe comment on a QA record and checking `/health` for a fresh `lastWebhookReceivedAt`.
- API/MCP-driven record moves did not emit `TODO_MOVED` during final verification. If instant move freshness matters, test a UI-driven move and keep reconciliation enabled as the catch-up path.

### 5. Configure LibreChat

Edit `env/librechat.env` and set:

- `DOMAIN_CLIENT`
- `DOMAIN_SERVER`
- `CREDS_KEY`
- `CREDS_IV`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `MEILI_MASTER_KEY`
- `OPENAI_API_KEY`
- `MONGO_INITDB_ROOT_PASSWORD`
- `MONGO_URI` with the same Mongo password and `authSource=admin`

Generate secrets with:

```bash
openssl rand -hex 32
openssl rand -hex 16
```

Use:

- 64 hex characters for `CREDS_KEY`
- 32 hex characters for `CREDS_IV`
- 64 hex characters for `JWT_SECRET`
- 64 hex characters for `JWT_REFRESH_SECRET`
- 64 hex characters for `MEILI_MASTER_KEY`

If you are upgrading an existing no-auth Mongo volume, there is usually no existing Mongo password. Before restarting the stack with authenticated Mongo, run:

```bash
./enable-mongo-auth.sh
```

That script generates a password if needed, writes it into `env/librechat.env` and `env/aya.env`, and creates the Mongo admin user in the currently running Mongo container. It does not print the password.

The default LibreChat endpoint is `openAI`, the default LibreChat model is `gpt-4o-mini`, and the default Aya tool-calling agent model is `gpt-4o`.

Edit `config/librechat.yaml` only if Aya-specific UI or policy settings need to change.

### 6. Start The Stack

Launch from the deployment directory:

```bash
docker compose up -d --build
```

Then validate immediately:

```bash
docker compose ps
curl http://127.0.0.1:3010/health
curl -I http://127.0.0.1:3080
```

Expected results:

- all containers are up or healthy
- Aya responds successfully on `127.0.0.1:3010/health`
- LibreChat responds on `127.0.0.1:3080`
- data appears under `/srv/aya/`
- neither application is listening on a public interface

### 7. Install Cloudflare Tunnel

Install `cloudflared` on the VM using Cloudflare's Linux instructions.

Then run:

```bash
cloudflared tunnel login
cloudflared tunnel create aya-pilot
cloudflared tunnel route dns aya-pilot copilot.ayafinancial.com
```

Update `/etc/cloudflared/config.yml` with:

- the tunnel ID
- the credentials file path
- the final hostnames

Then install and start the service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### 8. Add Cloudflare Access Rules

In Cloudflare Zero Trust:

1. Create an Access app for `copilot.ayafinancial.com`
2. Limit it to `@ayafinancial.com` users or a strict tester allow-list

This is the main external access control layer for the deployment.

## Post-Deploy Validation

After the stack is live, confirm the following:

- employees can reach the chat hostname only after passing Cloudflare Access
- public unauthenticated access is blocked
- LibreChat loads normally
- Aya tools respond through LibreChat
- a simple safe workflow works end to end

Recommended smoke test:

1. Log in as a pilot user
2. Ask Aya to search for a known client
3. Ask for recent comments on that client
4. Add a harmless test comment
5. Confirm the action appears correctly in Blue
6. Check Aya logs for the request

If that works, the deployment is operational.

## Day-2 Operations

For a deployment like this, operations should stay boring and repeatable.

Regular checks:

- `docker compose ps`
- `docker compose logs --tail=100 aya`
- `docker compose logs --tail=100 librechat`
- confirm Cloudflare Access is still enforcing login
- confirm available disk space is healthy

This setup does not need a large observability stack. For a 10-person team, container status, basic logs, and occasional manual checks are enough if they are done consistently.

## Upgrades

The upgrade path should stay simple:

1. take a VM snapshot or back up the key volumes
2. pull the updated repo
3. review env or config changes
4. run `docker compose up -d --build`
5. rerun the smoke test

This is not zero-downtime, and that is acceptable for this deployment model.

For a small internal team, short maintenance windows are usually the correct tradeoff.

## Backups

Minimum backup targets:

- Aya SQLite data in `/srv/aya/aya`
- LibreChat Mongo data in `/srv/aya/mongodb`
- LibreChat uploads in `/srv/aya/librechat/uploads`
- LibreChat logs in `/srv/aya/librechat/logs`

Recommended baseline:

- use Hostinger VPS snapshots before major changes
- run `./backup.sh` from `Blue/apps/copilot/deploy/hostinger` nightly
- store `/srv/aya/backups/<timestamp>/` artifacts off the VM
- test at least one restore path before relying on the system operationally

For Aya Financial's size, this is enough. You do not need a complex backup platform if nightly backups, off-VM copies, and VPS snapshots are done reliably.

## Failure Recovery

If the app goes down, recover in this order:

1. check `docker compose ps`
2. inspect Aya and LibreChat logs
3. restart the affected service or the full compose stack
4. verify localhost health checks
5. verify Cloudflare Tunnel status
6. rerun the smoke test

If the VM itself is lost:

1. recreate the VM
2. restore the repo and env/config files
3. restore the persistent data from snapshot or backup
4. start the compose stack
5. revalidate Cloudflare Tunnel and Access

That is an acceptable recovery model for a small internal system.

## What Not To Over-Engineer

Do not add the following unless there is a real operational need:

- Kubernetes
- managed Mongo just for appearance
- separate staging and production clusters for a tiny pilot
- heavy monitoring vendors
- complex CI/CD release gates
- extra services that raise cost without reducing real risk

The right architecture here is the one the team can actually operate confidently.

## Recommended Resume And LinkedIn Framing

This deployment supports claims like:

- architected a cost-conscious internal AI operations platform
- orchestrated Docker-based deployments on Hostinger VPS
- secured internal access with Cloudflare Tunnel and Cloudflare Access
- delivered a reliable one-VM deployment model for a small team

This deployment does not, by itself, support stronger claims like:

- built a globally distributed platform
- delivered formal high availability
- designed hyperscale infrastructure

Use precise language. The work is solid without exaggeration.
