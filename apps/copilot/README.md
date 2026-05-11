# Aya Copilot

Aya Copilot is the backend service that makes Aya Financial's LibreChat copilot useful for Blue CRM work.

It is not a standalone web app. The employee-facing UI is LibreChat in `apps/librechat`.

## Responsibilities

- expose the secured MCP server used by LibreChat
- resolve signed-in LibreChat users to Aya/Blue employees
- enforce Blue workspace guardrails
- read Blue records, assignments, comments, stages, activity, reports, and mentions
- perform approved Blue writes such as comments, lead creation, due-date updates, and stage moves
- maintain local SQLite cache tables for Blue data, sync state, audit logs, identity links, notifications, and copilot memory
- provide health, sync, auth, record, summary, message, webhook, and MCP HTTP routes

## What Was Removed

The separate React admin dashboard has been removed.

Managers and admins should use the chatbot itself for operational questions, for example:

- `who did what today?`
- `what is Hamza working on?`
- `show employee workload`
- `where have I been mentioned?`
- `show recent comments on AYA SMOKE TEST`

Admin-only tool access still exists inside the MCP/chat layer where it is useful. Only the visual `/admin` dashboard surface was removed.

## Run Locally

```bash
npm ci
npm run check
npm test
npm run build
npm run dev
```

Default local port:

- `http://127.0.0.1:3010`

Health check:

```bash
curl -fsS http://127.0.0.1:3010/health
```

## Required Environment

Use local untracked `.env` files. Do not commit secrets.

Core values:

- `BLUE_WORKSPACE_ID=cmn524yr800e101mh7kn44mhf`
- `BLUE_API_URL`
- `BLUE_AUTH_TOKEN` or the current Blue credential pair used by the integration
- `AYA_MCP_API_KEY`
- `AYA_HOSTINGER_MCP_API_KEY`
- `OPENAI_API_KEY`
- `LIBRECHAT_MONGO_URI`
- `LIBRECHAT_MONGO_DB_NAME`

Safety values:

- `ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false` for normal local work
- `ALLOW_BOOTSTRAP_PROVISIONING=false` unless intentionally bootstrapping a local demo

## Blue Workspace Safety

Allowed workspace:

- `03 - AYA x Hamza/ AI`
- `cmn524yr800e101mh7kn44mhf`

Forbidden workspace:

- `AYA sales CRM 3`
- `cmhazc4rl1vkand1eonnmiyjy`

The service should fail fast if configured with the forbidden workspace.

## Important Routes

- `GET /health`
- `POST /messages`
- `POST /sync/employees`
- `POST /sync/workspace-index`
- `POST /ingest/blue-activity`
- `GET /records/search`
- `GET /summary/team`
- `POST /mcp`
- `POST /mcp/hostinger`
- `POST /webhooks/blue`

Most business use should happen through LibreChat MCP tools, not direct route calls.

## Tests

```bash
npm run check
npm test
npm run build
```

The tests cover:

- workspace safety
- auth and route protection
- message identity spoofing protection
- Blue sync/cache behavior
- intent planning and disambiguation
- MCP audit/date guards
- employee identity resolution
- copilot message behavior

## Handoff

The main operator handoff is:

- `docs/internal/handoff.md`
