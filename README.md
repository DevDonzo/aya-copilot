# Aya Copilot for Blue

Aya Copilot is Aya Financial's internal chat and operations layer for Blue CRM.

This repository combines the employee chat surface, the secured backend that talks to Blue, deployment assets, and internal tooling in one workspace.

## What Lives Here

### `apps/librechat`

The employee-facing chat application.

- customized LibreChat deployment
- MCP client surface for Aya tools
- local and VPS runtime configuration

### `apps/copilot`

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
    -> Aya MCP
      -> Aya Copilot backend
        -> Vercel AI SDK agent
        -> policy/RBAC layer
        -> Blue GraphQL
        -> SQLite audit/cache

LibreChat
  -> MongoDB
  -> Meilisearch
```

## Naming Compatibility

The product is Aya Copilot and the backend app lives in `apps/copilot`. A few LibreChat internal identifiers still use `aya_ops` for MCP credential compatibility. Do not rename those keys unless you also migrate stored LibreChat MCP credentials.

## Deployment Surfaces

### Local Development

Primary local chat setup:

- [AYA_SETUP.md](apps/librechat/docs/AYA_SETUP.md)
- [docker-compose.yml](apps/librechat/docker-compose.yml)

The LibreChat compose file in `apps/librechat` is for local development only. Production should use the Hostinger bundle or an equivalent hardened compose with server-managed secrets and persistent data outside the repo tree.

### VPS / Hostinger

Primary single-server deployment bundle:

- [README.md](apps/copilot/deploy/hostinger/README.md)
- [docker-compose.yml](apps/copilot/deploy/hostinger/docker-compose.yml)
- [deployment-guide.md](docs/deployment-guide.md)

The Hostinger deployment is designed around one VPS, Docker Compose, bind-mounted state under `/srv/aya`, nightly backups, and optional Cloudflare protection in front.

## Workspace Safety

Blue writes are intentionally constrained during rollout.

- Allowed workspace ID: `cmhazc4rl1vkand1eonnmiyjy`
- Allowed workspace name: `00- AYA Sales CRM 3`
- Protected legacy pilot workspace ID: `cmn524yr800e101mh7kn44mhf`
- Protected legacy pilot workspace name: `03 - AYA x Hamza/ AI`

Any Blue write path should stay pinned to the allowed workspace only.

## Folder Hygiene

- keep product code under `apps/` and `tools/`
- keep durable docs under `docs/`
- keep internal notes and handoffs under `docs/internal/`
- keep local deployment env/data files out of version control
- do not leave ad hoc handoff files at the repo root

## Documentation Index

- [apps/copilot/docs/system-design.md](apps/copilot/docs/system-design.md)
- [apps/librechat/docs/AYA_SETUP.md](apps/librechat/docs/AYA_SETUP.md)
- [docs/deployment-guide.md](docs/deployment-guide.md)
- [docs/internal/handoff.md](docs/internal/handoff.md)
- [tools/blue-cli/README.md](tools/blue-cli/README.md)
- [docs/internal/README.md](docs/internal/README.md)

## Handoff Status

### Production URLs

- chat: `https://copilot.ayafinancial.com`

### Production State

- LibreChat is live and serving the Aya employee chat flow.
- Aya Copilot is live behind LibreChat and Blue health checks are passing.
- The production chat runtime is `AYA_CHAT_RUNTIME=agent`.
- The primary chat path is the Vercel AI SDK tool-calling agent using `gpt-4o-mini`; the old planner remains in code as an emergency rollback path.
- The separate visual admin dashboard has been removed.
- Managers should ask workload, assignment, and activity questions directly in LibreChat.
- Blue webhooks are registered, healthy, and have a stored signing secret. A real `COMMENT_CREATED` webhook was received after the latest deploy.
- Blue writes are constrained to the allowed workspace only:
  - `00- AYA Sales CRM 3`
  - `cmhazc4rl1vkand1eonnmiyjy`

### Signup Policy

- self-signup is enabled
- only `@ayafinancial.com` email addresses are allowed to register
- non-Aya domains are rejected at registration

### Aya / Blue Auth Model

- LibreChat identifies the signed-in employee
- Aya uses per-user Blue credentials for attributable Blue write actions
- Blue token values should be entered by the employee in the Aya MCP connection flow and must not be committed to the repository
- `AYA_MCP_API_KEY` is an internal shared secret between LibreChat and Aya Copilot
- it should exist in local untracked `.env` files and in production deployment env/secrets
- it must not be hardcoded in application code or committed to git

### Manager/Admin Use

- manager/admin reporting is available through the chatbot tools, not a separate dashboard
- manager/admin permissions should be assigned through the Aya Copilot auth/role layer
- do not store or commit live passwords in this repository

### Known Issues / Caveats

- Google OAuth was not treated as the primary production login path in the final handoff pass; password login is the verified path
- API/MCP-driven record moves did not emit a `TODO_MOVED` webhook during the final verification. Blue webhook delivery itself is working; comment webhooks were received and cache freshness updated. Specific record reads should continue to prefer live Blue reads, and reconciliation remains the catch-up path for missed move events.
- the repo is public, so any operational secrets, tokens, local env files, or runtime credentials must stay out of git
