# Blue Repository Agent Guide

This repository is Aya Financial's workspace for the Blue CRM copilot stack.

Use this file as the operating contract for any agent working in this repository.

## Primary Rule

Always use the `blue` MCP server for Blue workspace access when the task involves reading or changing Blue data.

## Repository Purpose

This repo contains three main product surfaces:

- `apps/librechat`: the employee-facing chat UI
- `apps/copilot`: the secured business-logic, MCP, audit, and admin layer
- `tools/blue-cli`: low-level Blue CLI and API tooling

It also contains deployment and reference material:

- `docs/`: architecture, deployment, and product docs
- `reference/`: exported schemas, API references, and research material
- `scripts/`: workspace utilities and one-off repo automation

## Top-Level Folder Conventions

- Keep product code in `apps/` and `tools/`.
- Keep durable documentation in `docs/`.
- Keep source-of-truth API/schema exports in `reference/`.
- Keep operational or handoff notes in `docs/internal/`.
- Do not leave temporary handoff files at the repository root.
- Do not commit local runtime data, deployment secrets, or generated database state.

## Deployment Layout

The main VPS deployment bundle lives in:

- `apps/copilot/deploy/hostinger/`

Important subpaths there:

- `docker-compose.yml`: single-VPS compose stack
- `env/`: local deployment environment files
- `config/`: LibreChat runtime config
- `cloudflared/`: tunnel example config
- `data/`: local persistent runtime state, intended to stay untracked

If deployment work is needed, prefer updating the checked-in examples and docs before editing live env files.

## Blue Workspace Safety

- Allowed production workspace name: `00- AYA Sales CRM 3`
- Allowed production workspace ID: `cmhazc4rl1vkand1eonnmiyjy`
- Protected legacy pilot workspace name: `03 - AYA x Hamza/ AI`
- Protected legacy pilot workspace ID: `cmn524yr800e101mh7kn44mhf`

## Hard Constraints

1. Never create, update, move, comment on, tag, delete, or otherwise modify anything outside `00- AYA Sales CRM 3` unless explicitly performing a documented migration/rollback task.
2. Never perform write actions against all workspaces or an unspecified workspace.
3. Before any write operation, confirm the target workspace ID is exactly `cmhazc4rl1vkand1eonnmiyjy`.
4. If a Blue request is ambiguous about workspace scope, stop and ask instead of acting.
5. Prefer workspace IDs over names when a tool accepts both.

## Hostinger / Infrastructure Rules

- Treat Hostinger access as production-adjacent infrastructure access.
- Default to read-only inspection unless the user explicitly asks for a change.
- Prefer documented deployment assets in `apps/copilot/deploy/hostinger/` over ad hoc commands.
- If deployment status in Hostinger conflicts with local docs, update the docs after confirming the real state.

## Documentation Maintenance Rules

- Update `README.md` when the top-level repo map or deployment approach changes.
- Update `docs/deployment-guide.md` when the Hostinger compose stack or rollout procedure changes.
- Update this file when workspace safety, folder conventions, or operational boundaries change.
