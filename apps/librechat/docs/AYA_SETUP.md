# Aya LibreChat Setup

This local setup treats LibreChat as the employee-facing front end and Aya as the MCP-backed business logic layer.

## Employee Prompt Style

Employees should talk to Aya naturally, not like they are filling out an API form.

Good examples:

- `what am i working on`
- `show comments for John Smith`
- `look up 416-555-0199`
- `move sheraz to underwriting`
- `create a new lead named john smith phone 4165550123 email john@example.com amount 275000`

LibreChat's model layer should extract structure from that language and call Aya's tools with explicit fields when needed.

## Current Local Shape

- LibreChat runs on `http://localhost:3080`
- Aya runs inside the same local app container as LibreChat and is also exposed on `http://localhost:3010`
- LibreChat connects to Aya over MCP at `http://127.0.0.1:3010/mcp` inside that container
- LibreChat passes the signed-in user's identity to Aya via:
  - `x-aya-employee-email: {{LIBRECHAT_USER_EMAIL}}`
  - `x-aya-employee-name: {{LIBRECHAT_USER_NAME}}`
- LibreChat can also store each employee's Blue personal token as encrypted Aya MCP custom user vars and pass them to Aya only for employee-triggered write actions:
  - `x-aya-blue-token-id: {{AYA_BLUE_TOKEN_ID}}`
  - `x-aya-blue-token-secret: {{AYA_BLUE_TOKEN_SECRET}}`

## Why This Works

LibreChat already provides:

- login and registration
- chat UI
- conversation history
- MCP server configuration
- optional future SSO with OpenID, SAML, or LDAP

Aya keeps:

- Aya-specific permissions
- audit logging
- Blue-safe CRM actions
- employee and manager summaries
- client search and detail logic

Blue attribution model:

- Aya keeps one system Blue token for background sync, health checks, and webhook management.
- Employee-triggered writes should use each employee's personal Blue token so Blue attributes moves/comments/creates to the real employee instead of the shared integration account.

## Important Constraint

The current identity bridge prefers the LibreChat user email and falls back to the LibreChat display name.

For example:

- LibreChat user email: `employee@ayafinancial.com`
- Aya synced email identity: `employee@ayafinancial.com`

That is enough for local testing and is also the right production direction.

## Deployment Options

Best first production option:

- Docker Compose on a VPS or cloud VM

Why:

- simplest to operate
- closest to upstream LibreChat deployment path
- easy to mount `librechat.yaml`
- easy to keep Aya on the same host or private network

Other valid options:

- Railway / Zeabur / Sealos
- Kubernetes with the Helm chart

Kubernetes is real and supported, but it is not the right first deployment for Aya unless you already run a cluster.

## Local Run

From the LibreChat repo root:

```bash
docker compose up -d
```

Then open:

```text
http://localhost:3080
```

The Docker app should show both of the application surfaces explicitly:

- `LibreChat`
- Aya is embedded in the `LibreChat` app container for local development

## Enterprise Files

Use these files when moving from local setup to a hardened internal deployment:

- `librechat.enterprise.yaml`
- `.env.enterprise.example`
- `ENTERPRISE_ROLLOUT.md`

## Production Recommendation

1. Host LibreChat at something like `https://ops.ayafinancial.com`
2. Host Aya on the same server or private network
3. Point LibreChat MCP to Aya over internal HTTP/HTTPS
4. Move from email login to company SSO later with OpenID
5. Ask each employee to open the Aya MCP server settings once and save their Blue Token ID and Secret

## Pilot Rollout Guidance

For the first internal pilot:

1. Start with search, detail, comments, and workload.
2. Then enable comments, stage moves, and lead creation.
3. Review audit logs and failed matches every week.
4. Put Cloudflare Access in front of the chat hostname before broader rollout.
