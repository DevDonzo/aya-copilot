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
- audit logging, sync jobs, and manager/admin chat tools

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
- [docs/internal/handoff.md](/Users/hparacha/AyaFinancial/Blue/docs/internal/handoff.md)
- [tools/blue-cli/README.md](/Users/hparacha/AyaFinancial/Blue/tools/blue-cli/README.md)
- [docs/internal/README.md](/Users/hparacha/AyaFinancial/Blue/docs/internal/README.md)

## Handoff Status

### Production URLs

- chat: `https://copilot.ayafinancial.com`

### Production State

- LibreChat is live and serving the Aya employee chat flow.
- Aya Ops is live behind LibreChat and Blue health checks are passing.
- The separate visual admin dashboard has been removed.
- Managers should ask workload, assignment, and activity questions directly in LibreChat.
- Blue writes are constrained to the allowed workspace only:
  - `03 - AYA x Hamza/ AI`
  - `cmn524yr800e101mh7kn44mhf`

### Signup Policy

- self-signup is enabled
- only `@ayafinancial.com` email addresses are allowed to register
- non-Aya domains are rejected at registration

### Aya / Blue Auth Model

- LibreChat identifies the signed-in employee
- Aya uses per-user Blue credentials for attributable Blue write actions
- Blue token values should be entered by the employee in the Aya MCP connection flow and must not be committed to the repository
- `AYA_MCP_API_KEY` is an internal shared secret between LibreChat and Aya Ops
- it should exist in local untracked `.env` files and in production deployment env/secrets
- it must not be hardcoded in application code or committed to git

### Manager/Admin Use

- manager/admin reporting is available through the chatbot tools, not a separate dashboard
- manager/admin permissions should be assigned through the Aya Ops auth/role layer
- do not store or commit live passwords in this repository

### Known Issues / Caveats

- Google OAuth was not treated as the primary production login path in the final handoff pass; password login is the verified path
- the repository CI currently has message-flow tests that depend on live Blue access and can fail when the external Blue GraphQL call returns `502` or times out
- the repo is public, so any operational secrets, tokens, local env files, or runtime credentials must stay out of git
