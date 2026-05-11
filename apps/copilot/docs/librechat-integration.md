# LibreChat Integration

LibreChat should be the employee-facing chat UI. Aya should remain the business logic layer behind it.

## Target Shape

1. LibreChat is hosted at a private employee-facing URL and handles employee login plus the chat experience.
2. Aya runs as the internal tool server and exposes an internal MCP endpoint to LibreChat.
3. LibreChat connects to Aya over MCP.
4. Aya resolves employee identity, applies role rules, logs requests, and then reads or writes Blue data in the allowed workspace only.

## Why This Split

Blue already owns CRM data and CRM actions.

Aya should only add the missing layer:

- employee identity
- permissions
- audit logs
- manager summaries
- name resolution for clients and stages
- cross-system activity over time

LibreChat should not talk directly to Blue. It should talk to Aya.

## Current MCP Endpoint

- method: `GET` and `POST`
- path: `/mcp`
- current scope: `03 - AYA x Hamza/ AI`
- workspace ID: `cmn524yr800e101mh7kn44mhf`

## Exposed Aya Tools

- `aya_message`
- `aya_search_clients`
- `aya_get_client_detail`
- `aya_get_employee_day_summary`
- `aya_get_team_day_summary`
- `aya_get_employee_workload`
- `aya_move_client_to_stage`
- `aya_add_client_comment`

## Identity Headers

Aya write tools currently require one of these request headers:

- `x-aya-employee-email`
- `x-aya-employee-id`
- `x-aya-employee-name`

Those headers are the current bridge between the chat UI and Aya's permission model.

## Recommended Production Setup

1. Host LibreChat in the cloud at a private employee-facing domain.
2. Host Aya on the same private network as LibreChat.
3. Do not expose Aya publicly unless there is a clear operational reason.
4. Keep manager/admin reporting role-gated inside the chatbot/MCP layer.
5. Configure LibreChat to use Aya as an MCP server over the private network.
6. Pass the signed-in employee identity to Aya in request headers.

## First LibreChat Config Shape

Use Aya as a remote MCP server rather than embedding Blue logic directly in LibreChat.

Example shape:

```yaml
mcpServers:
  aya-ops:
    type: streamable-http
    url: http://aya-backend:3010/mcp
    headers:
      x-aya-employee-email: "{{LIBRECHAT_USER_EMAIL}}"
      x-aya-employee-name: "{{LIBRECHAT_USER_NAME}}"
```

The exact LibreChat config format should follow the current LibreChat MCP docs, but the important point is the architecture:

- LibreChat is the chat UI
- Aya is the tool/permission layer
- Blue stays the CRM system of record

## Private Deployment Notes

Recommended internal access pattern:

- employees use LibreChat only
- admins use manager/admin chatbot tools separately
- Aya MCP and Blue credentials stay private

Suggested hostnames:

- employee chat: `chat-internal.ayafinancial.com`
- manager reporting: role-gated prompts inside LibreChat

Aya itself can stay on an internal Docker network and only be reachable by:

- LibreChat
- the reverse proxy
- admins on the private route

## Current Limitation

The current bridge is ready for local and early cloud testing, and it now supports LibreChat user placeholders for email and display name. The next production hardening step is to make company email the required identity key and back LibreChat with the real employee auth provider instead of relying on local email/password accounts.
