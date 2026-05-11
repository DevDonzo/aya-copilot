# Aya Copilot Handoff

Last updated: May 11, 2026

This is the handoff document for the Aya Financial Blue CRM copilot stack in:

- `/Users/hparacha/AyaFinancial/Blue`

## Executive Summary

Aya Copilot is an internal LibreChat-based assistant for Aya Financial employees and managers.

The useful product surface is:

- `https://copilot.ayafinancial.com`

The separate visual admin dashboard has been removed. Managers should use the chatbot itself for workload, assignment, and activity questions.

The stack has three active code areas:

- `apps/librechat`: employee-facing chat UI and LibreChat runtime
- `apps/aya-ops-bot`: secured Aya business logic, MCP tools, Blue sync, audit, memory, auth, and guardrails
- `tools/blue-cli`: low-level Blue API CLI for maintenance and diagnostics

## What This Can Do For The Team

Aya Copilot is useful because it lets employees ask operational Blue questions in plain English instead of clicking through Blue manually.

Current useful workflows:

- show an employee their open assignments
- find where an employee was mentioned
- summarize recent comments on a client/file
- show recent activity on a client/file
- add a follow-up note to a Blue record
- move a record to another stage
- create a new lead/client record
- update due dates when the required data is clear
- ask what happened today, yesterday, this week, or in a date range
- ask what a specific employee worked on
- ask manager-style workload questions across employees
- ask about Blue reports/dashboards through chat
- preserve recent record context so follow-up commands like `mark it complete` can refer to the previous record

Strong demo prompts:

```text
what can you do for Aya Financial?
show my assignments
where have I been mentioned?
show recent comments on AYA SMOKE TEST - OpenAI gpt-4o-mini
who did what today?
what is Hamza working on?
show employee workload
add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: demo handoff note
mark AYA SMOKE TEST - OpenAI gpt-4o-mini complete
```

For live demos, prefer the smoke-test record and avoid customer records.

## Product Boundary

Aya is not a replacement for Blue.

Blue remains the system of record for:

- records
- lists/stages
- assignments
- comments
- mentions
- users
- reports
- activity history

Aya owns:

- chat-to-action routing
- employee identity mapping
- per-user Blue credential handling
- local cache and memory
- sync jobs
- audit logs
- safety checks
- workspace guardrails
- MCP tools exposed to LibreChat

## Blue Workspace Safety

Allowed Blue workspace:

- name: `03 - AYA x Hamza/ AI`
- ID: `cmn524yr800e101mh7kn44mhf`

Forbidden Blue workspace:

- name: `AYA sales CRM 3`
- ID: `cmhazc4rl1vkand1eonnmiyjy`

Hard rule:

- never write to `cmhazc4rl1vkand1eonnmiyjy`
- never run writes against all workspaces
- never run writes without a resolved workspace ID
- before any Blue write, the target workspace must be `cmn524yr800e101mh7kn44mhf`

## Authentication Model

LibreChat account auth:

- users sign up or sign in through `https://copilot.ayafinancial.com`
- email/password login is the verified production path
- Google/social login is disabled
- self-signup is enabled only for `@ayafinancial.com` email addresses
- passwords are handled by LibreChat/MongoDB, not by Aya Ops code

Blue action auth:

- Aya receives the signed-in LibreChat user's email
- Aya maps that user to an internal employee identity
- Blue writes should use per-user Blue credentials when configured
- system Blue fallback is disabled by default for safer local and production behavior

Internal MCP auth:

- `AYA_MCP_API_KEY` protects the normal Aya MCP surface
- `AYA_HOSTINGER_MCP_API_KEY` protects Hostinger/infrastructure MCP access separately
- do not commit either value

## Required Local Files

Local secrets and runtime data stay untracked.

Common local files:

- `apps/librechat/.env`
- `apps/librechat/.blue-local.env`
- `apps/aya-ops-bot/.env`
- `apps/aya-ops-bot/deploy/hostinger/env/aya.env`
- `apps/aya-ops-bot/deploy/hostinger/env/librechat.env`
- `.local/blue-api-token.json`

Important environment values:

```text
BLUE_WORKSPACE_ID=cmn524yr800e101mh7kn44mhf
BLUE_API_URL=...
BLUE_AUTH_TOKEN=...
BLUE_CLIENT_ID=...
BLUE_COMPANY_ID=...
OPENAI_API_KEY=...
AYA_MCP_API_KEY=...
AYA_HOSTINGER_MCP_API_KEY=...
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
ALLOW_BOOTSTRAP_PROVISIONING=false
```

LibreChat production auth values:

```text
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_SOCIAL_REGISTRATION=false
ALLOW_PASSWORD_RESET=false
ALLOW_UNVERIFIED_EMAIL_LOGIN=true
```

## How To Run Locally

Install and test Aya Ops:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot
npm ci
npm run check
npm test
npm run build
```

Run Aya Ops locally:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot
npm run dev
```

Aya health:

```bash
curl -fsS http://127.0.0.1:3010/health
```

Run LibreChat locally:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/librechat
npm ci
docker compose up -d
```

Local chat URL:

```text
http://127.0.0.1:3080
```

If using the local override stack, confirm:

```text
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
BLUE_WORKSPACE_ID=cmn524yr800e101mh7kn44mhf
```

## How To Test

Aya backend:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot
npm run check
npm test
npm run build
```

LibreChat backend/client:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/librechat
npm run build:api
npm run build:client
npm run test:api
npm run test:client
```

Blue CLI:

```bash
cd /Users/hparacha/AyaFinancial/Blue/tools/blue-cli
go test ./...
go build ./...
```

Production health smoke:

```bash
curl -fsS https://copilot.ayafinancial.com/health
curl -fsS https://copilot.ayafinancial.com/api/config
curl -fsSI https://copilot.ayafinancial.com/login
```

Expected production health:

```json
{
  "ok": true,
  "database": { "ok": true },
  "blueApi": { "ok": true }
}
```

Expected production config values:

```json
{
  "appTitle": "AYA Copilot",
  "emailLoginEnabled": true,
  "registrationEnabled": true,
  "socialLoginEnabled": false,
  "googleLoginEnabled": false
}
```

Optional chatbot smoke script:

```bash
cd /Users/hparacha/AyaFinancial/Blue
LIBRECHAT_EMAIL="someone@ayafinancial.com" \
LIBRECHAT_PASSWORD="..." \
node scripts/librechat_demo_smoke.mjs --base-url=https://copilot.ayafinancial.com
```

Default smoke mode is read-only. Use `--full-demo` only when you intentionally want live Blue writes.

## Deployment

Production deployment assets live here:

- `apps/aya-ops-bot/deploy/hostinger/`

Primary compose file:

- `apps/aya-ops-bot/deploy/hostinger/docker-compose.yml`

Production URL:

- `https://copilot.ayafinancial.com`

On the VPS, the repo is expected at:

```text
~/Blue
```

Deployment command on the VPS:

```bash
cd ~/Blue/apps/aya-ops-bot/deploy/hostinger
docker compose up -d --build
```

Post-deploy checks:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3010/health
curl -fsSI http://127.0.0.1:3080
```

Public checks:

```bash
curl -fsS https://copilot.ayafinancial.com/health
curl -fsS https://copilot.ayafinancial.com/api/config
```

## Production Services

Hostinger compose services:

- `aya`: Aya Ops backend, port `3010` bound to localhost
- `librechat`: LibreChat app/API, port `3080` bound to localhost
- `mongodb`: LibreChat MongoDB
- `meilisearch`: LibreChat search

Persistent state:

- `apps/aya-ops-bot/deploy/hostinger/data/aya`
- `apps/aya-ops-bot/deploy/hostinger/data/mongodb`
- `apps/aya-ops-bot/deploy/hostinger/data/meilisearch`
- `apps/aya-ops-bot/deploy/hostinger/data/librechat/uploads`
- `apps/aya-ops-bot/deploy/hostinger/data/librechat/logs`

Do not commit anything under deployment `data/`.

## File Structure

Clean top-level map:

```text
apps/
  aya-ops-bot/
  librechat/
docs/
  architecture/
  internal/
  mcp/
  product/
reference/
scripts/
tools/
  blue-cli/
AGENTS.md
README.md
```

Conventions:

- product code goes under `apps/` and `tools/`
- durable docs go under `docs/`
- handoff/internal ops notes go under `docs/internal/`
- API exports and external references go under `reference/`
- local runtime data and secrets stay untracked

## Removed Admin Dashboard

The previous React admin dashboard was intentionally removed.

Removed pieces:

- `apps/aya-ops-bot/admin-ui`
- `/admin` web surface
- dashboard-specific route tests
- admin UI build/install steps
- admin static serving from the Aya backend

Kept pieces:

- manager/admin chatbot tools
- auth and role layer
- sync routes
- audit data
- activity reporting logic used by chat
- Blue reporting helpers used by chat

Reason:

- the team wants one clear interface, the chatbot
- the previous dashboard was not useful enough for handoff
- manager visibility should be available through natural-language prompts

## Useful Chatbot Examples By Role

Employee:

```text
show my assignments
where have I been mentioned?
what changed on my files today?
show recent comments on [client name]
add a note to [client name]: [note]
move [client name] to underwriting
create a lead for [client name] with phone [number]
```

Manager:

```text
who did what today?
what is Hamza working on?
which employees have overdue assignments?
show employee workload
what clients moved stages today?
show recent comments by Sarah
what happened on [client name] this week?
```

Operations:

```text
sync employees
sync workspace index
show Blue reporting
what dashboards or reports are available?
who touched [client name]?
```

## How This Can Become More Useful

Highest-value next steps:

1. Underwriting file validation
2. Credit union / Moya package preparation
3. Human-in-the-loop checklist review
4. Document intake and missing-item detection
5. SLA and overdue-assignment alerts
6. Better manager summaries in chat
7. More precise Blue mention notification handling
8. Role-based prompt examples inside LibreChat
9. Automated daily briefs to each employee
10. Approval flows for risky writes

Target future workflow:

1. employee uploads or points Aya to an underwriting file
2. Aya checks required documents and values
3. Aya flags missing or inconsistent items
4. human reviews and approves
5. Aya prepares the package for credit union / Moya submission
6. turnaround drops from days to hours while keeping human control

## Handoff Caveats

- Do not claim the system is flawless. Say it has passed the current sweep and has production guardrails.
- Blue is an external dependency; if Blue GraphQL is slow or returns `502`, some live tests can fail.
- Use read-only demo prompts unless you intentionally want to write to Blue.
- Never demo writes on real customer records.
- Keep Google/social login disabled unless someone intentionally reconfigures OAuth.
- Keep production secrets out of git.

