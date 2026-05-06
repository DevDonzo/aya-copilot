# Aya Copilot for Blue

Aya Copilot is Aya Financial's internal chat and operations layer for Blue CRM.

This repository combines the employee chat surface, the secured backend that talks to Blue, deployment assets, and internal tooling in one workspace.

## What Lives Here

### `apps/librechat`

The employee-facing chat application.

- customized LibreChat deployment
- MCP client surface for Aya tools
- local and VPS runtime configuration

### `apps/aya-ops-bot`

The operational backend.

- Fastify + TypeScript service
- MCP server for LibreChat
- Blue integration, identity resolution, and write guardrails
- audit logging, sync jobs, and admin UI

### `tools/blue-cli`

The low-level Blue CLI workspace for direct API operations and maintenance tasks.

### `docs/`

Project documentation, including architecture and deployment procedures.

### `reference/`

Reference exports, schemas, and supporting research artifacts.

## Architecture

```text
Employee
  -> LibreChat
    -> Aya MCP / HTTP
      -> Blue GraphQL
      -> SQLite
      -> Admin UI

LibreChat
  -> MongoDB
  -> Meilisearch
```

## Deployment Surfaces

### Local Development

Primary local chat setup:

- [AYA_SETUP.md](/Users/hparacha/AyaFinancial/Blue/apps/librechat/docs/AYA_SETUP.md)
- [docker-compose.yml](/Users/hparacha/AyaFinancial/Blue/apps/librechat/docker-compose.yml)

### VPS / Hostinger

Primary single-server deployment bundle:

- [README.md](/Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot/deploy/hostinger/README.md)
- [docker-compose.yml](/Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot/deploy/hostinger/docker-compose.yml)
- [deployment-guide.md](/Users/hparacha/AyaFinancial/Blue/docs/deployment-guide.md)

The Hostinger deployment is designed around one VPS, Docker Compose, bind-mounted state, and optional Cloudflare protection in front.

## Workspace Safety

Blue writes are intentionally constrained during rollout.

- Allowed workspace ID: `cmn524yr800e101mh7kn44mhf`
- Allowed workspace name: `03 - AYA x Hamza/ AI`
- Forbidden workspace ID: `cmhazc4rl1vkand1eonnmiyjy`
- Forbidden workspace name: `AYA sales CRM 3`

Any Blue write path should stay pinned to the allowed workspace only.

## Folder Hygiene

- keep product code under `apps/` and `tools/`
- keep durable docs under `docs/`
- keep internal notes and handoffs under `docs/internal/`
- keep local deployment env/data files out of version control
- do not leave ad hoc handoff files at the repo root

## Documentation Index

- [apps/aya-ops-bot/docs/system-design.md](/Users/hparacha/AyaFinancial/Blue/apps/aya-ops-bot/docs/system-design.md)
- [apps/librechat/docs/AYA_SETUP.md](/Users/hparacha/AyaFinancial/Blue/apps/librechat/docs/AYA_SETUP.md)
- [docs/deployment-guide.md](/Users/hparacha/AyaFinancial/Blue/docs/deployment-guide.md)
- [tools/blue-cli/README.md](/Users/hparacha/AyaFinancial/Blue/tools/blue-cli/README.md)
- [docs/internal/README.md](/Users/hparacha/AyaFinancial/Blue/docs/internal/README.md)
