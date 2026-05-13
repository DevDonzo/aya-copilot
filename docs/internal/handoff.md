# Aya Copilot Handoff and Security Guide

Last updated: May 11, 2026

This document is the email-safe handoff for Aya Financial's Blue CRM copilot stack.

It intentionally does not contain real API keys, passwords, tokens, SSH keys, database dumps, or customer data. Share this document freely with the implementation team, but send actual secrets through a password manager or another approved secure channel.

## 1. Executive Summary

Aya Copilot is an internal chatbot built on LibreChat plus a custom Aya Copilot backend. It lets Aya employees ask Blue CRM questions and perform approved Blue actions from chat.

Production URL:

```text
https://copilot.ayafinancial.com
```

Primary user surface:

```text
LibreChat frontend at copilot.ayafinancial.com
```

Removed surface:

```text
/admin
```

The separate custom admin dashboard was removed. Managers should ask workload, assignment, employee activity, and client activity questions directly in the chatbot.

The system is made from three active code areas:

```text
apps/librechat       LibreChat frontend/API, login, chat UI, MCP client, OpenAI model access
apps/copilot     Aya business logic, Blue MCP tools, Blue sync, memory, audit, auth guardrails
tools/blue-cli       Low-level Blue API CLI for maintenance and diagnostics
```

Naming note:

The product and backend are now called Aya Copilot. Some LibreChat internal keys can still contain `aya_ops` because that key is tied to existing MCP credential storage and model wiring. Treat it as a compatibility identifier, not the product name. Rename it only with a planned LibreChat credential/data migration.

Supporting folders:

```text
docs/                durable documentation
reference/           exported schemas/API references/research
scripts/             repo utilities, production verification, demo smoke scripts
.github/workflows/   CI/CD deployment pipeline
```

## 2. What Aya Copilot Can Do

Useful employee workflows:

```text
show my assignments
where have I been mentioned?
show recent comments on a client/file
show recent activity on a client/file
add a follow-up note to a Blue record
move a record to another Blue list/stage
create a lead/client record
update due dates when the required data is clear
ask what happened today/yesterday/this week
ask what a specific employee worked on
ask manager-style workload questions across employees
ask about Blue reports/dashboards through chat
continue context, for example asking "mark it complete" after discussing one record
```

Recommended demo prompts:

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

Demo safety rule:

```text
Use the smoke-test record for live demos. Do not demo against customer records unless the team intentionally approves it.
```

## 3. Product Boundary

Blue remains the system of record.

Blue owns:

```text
records
lists/stages
assignments
comments
mentions
users
reports
activity history
```

Aya Copilot owns:

```text
chat-to-action routing
employee identity mapping
per-user Blue credential handling
local Blue cache
recent context/memory scoped by employee and conversation
audit logging
sync jobs
safety guardrails
MCP tools exposed to LibreChat
```

Aya should not be treated as a second CRM. If Aya and Blue disagree, Blue wins.

## 4. Blue Workspace Safety

Allowed Blue workspace:

```text
Name: 03 - AYA x Hamza/ AI
ID:   cmn524yr800e101mh7kn44mhf
```

Forbidden Blue workspace:

```text
Name: AYA sales CRM 3
ID:   cmhazc4rl1vkand1eonnmiyjy
```

Important context:

```text
This forbidden-workspace setting is a temporary development and intern safety guardrail.
It exists because the Copilot was built and tested with agentic coding tools and should not accidentally touch the real company CRM before an authorized owner accepts that risk.
It is not a permanent product requirement.
When Aya's authorized technical owner is ready to move the Copilot to the live CRM, they should intentionally replace this guardrail with the approved live workspace policy instead of treating the current forbidden value as final.
```

Hard rules:

```text
Never write to cmhazc4rl1vkand1eonnmiyjy.
Never run writes against all workspaces.
Never run writes without a resolved workspace ID.
Before any Blue write, the target workspace must be cmn524yr800e101mh7kn44mhf.
If workspace scope is ambiguous, stop and ask.
Prefer workspace IDs over names.
```

Code-level guardrails:

```text
apps/copilot/src/config.ts refuses to boot if BLUE_WORKSPACE_ID is the forbidden workspace.
apps/copilot/src/config.ts refuses to boot if BLUE_READ_WORKSPACE_ID is the forbidden workspace.
apps/copilot/src/config.ts refuses production boot if system Blue write fallback, dev default actor, bootstrap provisioning, or full audit stdout logging are enabled.
apps/copilot/src/config.ts requires production Blue system read credentials for sync and health checks.
Aya tools use config.BLUE_WORKSPACE_ID for Blue read/write paths.
AGENTS.md repeats the same workspace contract for future agents.
```

## 4A. How To Move Aya From The Pilot Workspace To Another Blue Workspace

The current working pilot workspace is:

```text
Name: 03 - AYA x Hamza/ AI
ID:   cmn524yr800e101mh7kn44mhf
```

Reading and writing currently works against that workspace.

To move Aya to a different Blue workspace, do not guess the workspace ID. First identify the exact Blue workspace ID, confirm it with the business owner, and then update the config and guardrails deliberately.

Ways to find the real Blue workspace ID:

```text
Option 1: Use the Blue CLI.
Run blue workspaces list --simple.
Find the exact workspace name and copy its ID.

Option 2: Use Blue API tooling.
List workspaces with the authenticated Blue token and copy the ID for the intended workspace.

Option 3: Use Blue UI/API inspection.
Open the workspace in Blue and inspect the URL/network/API response if the UI exposes the workspace ID.
Do not rely on a similar-looking workspace name.
```

Before changing production, verify:

```text
The workspace name is exactly the workspace Aya should operate in.
The workspace ID is copied exactly.
The Blue token has permission to read that workspace.
The Blue token has permission to write only if write actions are intended.
The team accepts that Aya actions can create comments, move records, create leads, and update fields there.
```

Files/settings that must be updated:

```text
apps/copilot/deploy/hostinger/env/aya.env
BLUE_WORKSPACE_ID=<new-workspace-id>
BLUE_READ_WORKSPACE_ID=<new-workspace-id if read/write should use the same workspace>

apps/copilot/src/config.ts
Review safeBlueWorkspaceId and forbiddenBlueWorkspaceId before changing workspace policy.

AGENTS.md
Update allowed workspace name/ID and forbidden workspace name/ID.

docs/internal/handoff.md
Update this handoff so future owners know the new source-of-truth workspace.
```

If the intended production workspace is currently listed as forbidden in this repo, do not only change the env file. The app is designed to refuse boot against that workspace. A developer must intentionally update the code guardrails, `AGENTS.md`, and this handoff in the same change so the safety policy matches the new operating model.

The current forbidden workspace should be removed or changed only during an authorized live CRM cutover. That change should be made by the new owner after repository transfer, VPS access transfer, and secret handoff are complete. The expected change is not "delete all safety"; it is "replace the intern/dev safety policy with Aya's approved production workspace policy."

Safe migration process:

```text
1. Get written approval for the new Blue workspace.
2. Find and confirm the exact workspace ID.
3. Update the env/config/docs/guardrails.
4. Deploy.
5. Run node scripts/verify_production.mjs.
6. Ask read-only questions first.
7. Run one write test on a harmless smoke-test record in the new workspace.
8. Confirm the action appeared correctly in Blue.
9. Only then allow broader team usage.
```

Recommended first prompts after switching workspace:

```text
what workspace are you connected to?
show my assignments
show recent comments on the smoke test record
add follow up note to the smoke test record: Aya migration test
show activity on the smoke test record
```

Rollback plan:

```text
Set BLUE_WORKSPACE_ID and BLUE_READ_WORKSPACE_ID back to cmn524yr800e101mh7kn44mhf.
Redeploy the Hostinger compose stack.
Run node scripts/verify_production.mjs.
Confirm Blue reads and writes are back in the pilot workspace.
```

## 5. High-Level Architecture

Request flow:

```text
User browser
  -> copilot.ayafinancial.com
  -> LibreChat container
  -> OpenAI model selected by LibreChat
  -> LibreChat MCP client
  -> Aya Copilot MCP endpoint inside Docker network
  -> Aya Copilot Blue tools
  -> Blue GraphQL API
```

Production compose services:

```text
aya          custom Aya Copilot backend, container name aya-copilot, port 3010 bound to 127.0.0.1
librechat    LibreChat app/API, port 3080 bound to 127.0.0.1
mongodb      LibreChat MongoDB, private Docker network only
meilisearch  LibreChat search, private Docker network only
```

Important deployment directory:

```text
apps/copilot/deploy/hostinger/
```

Important deployment files:

```text
apps/copilot/deploy/hostinger/docker-compose.yml
apps/copilot/deploy/hostinger/config/librechat.yaml.example
apps/copilot/deploy/hostinger/env/aya.env.example
apps/copilot/deploy/hostinger/env/librechat.env.example
```

Runtime files that must stay untracked:

```text
apps/copilot/deploy/hostinger/env/aya.env
apps/copilot/deploy/hostinger/env/librechat.env
apps/copilot/deploy/hostinger/config/librechat.yaml
apps/copilot/deploy/hostinger/data/
apps/librechat/.blue-local.env
.local/blue-api-token.json
```

Current `.gitignore` ignores these runtime secret/data files.

## 6. Authentication Model

LibreChat account auth:

```text
Users sign up or sign in at https://copilot.ayafinancial.com.
Email/password login is the intended production path.
Google/social login is disabled.
Self-signup is enabled.
Signup is restricted to the ayafinancial.com email domain through LibreChat config.
Passwords are handled by LibreChat and stored in MongoDB using LibreChat's password hashing flow.
Aya Copilot does not store LibreChat user passwords.
```

LibreChat registration domain enforcement:

```text
apps/copilot/deploy/hostinger/config/librechat.yaml.example has registration.allowedDomains = ayafinancial.com.
LibreChat checks this in its auth service before creating accounts.
```

Aya Copilot session auth:

```text
Aya Copilot has its own employee/session layer for direct Aya routes.
Session cookie name is aya_session.
Cookies are httpOnly.
Production cookies become secure when the incoming protocol is HTTPS.
Session TTL is controlled by AUTH_SESSION_TTL_HOURS.
Bootstrap provisioning is blocked in production.
```

Aya MCP auth:

```text
/mcp requires x-aya-internal-key matching AYA_MCP_API_KEY.
/mcp/hostinger requires x-aya-hostinger-internal-key matching AYA_HOSTINGER_MCP_API_KEY.
The Hostinger MCP key is intentionally separate from the normal Aya MCP key.
```

LibreChat should send the signed-in user identity to Aya MCP through:

```text
x-aya-employee-email: {{LIBRECHAT_USER_EMAIL}}
x-aya-employee-name: {{LIBRECHAT_USER_NAME}}
```

There is intentionally no employee fallback for MCP calls. If LibreChat does not send a signed-in user email/name, Aya should reject the request instead of silently attributing it to another employee.

Blue action auth:

```text
LibreChat passes the signed-in user's email/name to Aya Copilot through MCP headers.
Users can save personal Blue Token ID and Blue Token Secret in LibreChat MCP user variables.
LibreChat stores those user variables encrypted using CREDS_KEY.
Aya Copilot uses per-user Blue credentials for write actions when provided.
System Blue write fallback should remain disabled in production.
```

Important write-safety setting:

```text
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
```

If this is false and a user tries a write without personal Blue credentials, Aya should refuse with a message telling the user to connect their Blue account.

## 7. Required Secrets and What They Are For

Do not email actual values. Send values through a password manager or secure secret-transfer tool.

Aya Copilot secrets:

```text
BLUE_WORKSPACE_ID
Purpose: locks Aya to the allowed Blue workspace.
Production value should be cmn524yr800e101mh7kn44mhf.

BLUE_API_URL
Purpose: Blue GraphQL endpoint.
Typical value is https://api.blue.cc/graphql.

BLUE_AUTH_TOKEN
Purpose: system Blue token secret used for read/sync and optional fallback operations.
Required for Blue API connectivity and background sync.
Rotate if exposed.

BLUE_CLIENT_ID
Purpose: Blue token ID paired with BLUE_AUTH_TOKEN.
Required for Blue API connectivity.
Rotate if exposed with its token secret.

BLUE_COMPANY_ID
Purpose: Blue company/account identifier used by Blue GraphQL calls.
Required for user/reporting operations.

AYA_MCP_API_KEY
Purpose: internal shared secret between LibreChat and Aya Copilot /mcp.
Generate as a long random value, for example openssl rand -hex 32.
Rotate if exposed.

AYA_HOSTINGER_MCP_API_KEY
Purpose: separate internal shared secret for /mcp/hostinger.
Generate separately from AYA_MCP_API_KEY.
Rotate if exposed.

HOSTINGER_API_KEY
Purpose: Hostinger API operations through the Hostinger MCP surface.
Highest sensitivity because it controls infrastructure.
Only configure if Hostinger tools are needed.
Rotate if exposed.

BLUE_WEBHOOK_SECRET
Purpose: verifies Blue webhook signatures if webhooks are enabled.
Required only when BLUE_WEBHOOK_PUBLIC_URL is configured.

AUTH_BOOTSTRAP_KEY
Purpose: local/non-production provisioning bootstrap.
Do not enable production bootstrap provisioning.

LIBRECHAT_MONGO_URI
Purpose: allows Aya Copilot to inspect LibreChat data when needed for transcript/reporting features.
Production points to MongoDB inside the Docker network.
```

LibreChat secrets:

```text
OPENAI_API_KEY
Purpose: model access for LibreChat.
Rotate immediately if it was pasted into chat, email, screenshots, or logs.

CREDS_KEY
Purpose: encrypts user-provided credentials in LibreChat, including MCP user variables.
Must be a strong random value.
If rotated, previously encrypted user credentials may need to be re-entered.

JWT_SECRET
Purpose: LibreChat auth/session token signing.
Must be a strong random value.
Rotating may invalidate sessions.

JWT_REFRESH_SECRET
Purpose: LibreChat refresh-token signing if configured.
Must be a strong random value.

MEILI_MASTER_KEY
Purpose: protects Meilisearch.
Must be a strong random value.

MONGO_URI
Purpose: LibreChat MongoDB connection string.
In production this points to the private Docker MongoDB service.
```

Optional/social login secrets:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALLBACK_URL
```

These should not be active in the current production configuration because Google/social login is intentionally disabled.

## 8. Current Security Posture

Implemented controls:

```text
Public app is LibreChat only.
Aya Copilot port 3010 is bound to 127.0.0.1 on the VPS and is also available privately inside the Docker network.
LibreChat port 3080 is bound to 127.0.0.1 on the VPS behind the public proxy/tunnel.
MongoDB and Meilisearch are not publicly exposed by docker-compose.yml.
/mcp requires AYA_MCP_API_KEY.
/mcp/hostinger requires AYA_HOSTINGER_MCP_API_KEY.
Message routes require authenticated Aya sessions.
Intent-test route is admin-only.
Record and summary routes are protected.
Sync and identity-link routes are admin-only.
Bootstrap provisioning is not allowed in production.
Forbidden Blue workspace boot is blocked.
Google/social login is disabled in production.
Self-signup is domain-limited to ayafinancial.com.
/admin is intentionally removed and production verification expects 404.
CI/CD builds/tests before deploy and verifies production after deploy.
```

Important limitations:

```text
Email domain signup is not the same as full enterprise SSO.
If email verification is not enforced by SMTP, an attacker who can receive or control an @ayafinancial.com address could create an account.
Per-user Blue write attribution depends on each user saving their own Blue Token ID and Secret.
If system fallback is enabled, writes can happen through the shared system Blue credential, which is less attributable.
Local SQLite/data files and MongoDB contain operational metadata and should be backed up/encrypted according to company policy.
Chatbot answers depend on Blue API data freshness and tool routing; Blue remains the source of truth.
```

Recommended next security upgrades:

```text
Enable proper email verification or SSO before broader rollout.
Move production secrets into a managed secret store instead of flat env files.
Add VPS firewall rules that allow only required inbound ports.
Add fail2ban or equivalent SSH protection if not already configured.
Use a non-root deploy user on the VPS instead of root SSH deploy.
Add periodic encrypted backups for MongoDB and Aya data.
Add alerting for failed production verification, failed health, and repeated auth failures.
Add dependency vulnerability scanning with npm audit or Dependabot alerts.
Add rate limiting around auth and MCP endpoints if public exposure changes.
Review Hostinger MCP necessity; leave disabled unless actively needed.
```

## 9. Secret Handling and Rotation Rules

Never commit these files:

```text
apps/copilot/deploy/hostinger/env/aya.env
apps/copilot/deploy/hostinger/env/librechat.env
apps/copilot/deploy/hostinger/config/librechat.yaml
.local/blue-api-token.json
apps/librechat/.blue-local.env
```

Before handoff, rotate anything that was ever shared outside a secure secret manager.

High-priority rotation list:

```text
OPENAI_API_KEY if it was pasted into any chat/email/screenshot.
BLUE_AUTH_TOKEN and BLUE_CLIENT_ID if copied into chat/email or exposed on a shared machine.
HOSTINGER_API_KEY if copied into chat/email or exposed on a shared machine.
AYA_MCP_API_KEY and AYA_HOSTINGER_MCP_API_KEY after final handoff if multiple people saw them.
CREDS_KEY/JWT_SECRET/MEILI_MASTER_KEY only with a planned maintenance window because rotation can affect sessions/stored user keys/search.
```

Rotation process:

```text
1. Generate the new key/token in the source system.
2. Update the VPS env file or secret store.
3. Restart the affected Docker service.
4. Run node scripts/verify_production.mjs.
5. Confirm users can sign in and run a read-only Blue query.
6. Revoke the old key/token.
```

Safe random secret generation:

```bash
openssl rand -hex 32
```

Git/history note:

```text
As of this handoff, the local runtime env files are ignored by .gitignore and the exact hostinger env/config runtime paths have no Git history in this repo check.
That does not protect secrets pasted into chat, email, screenshots, terminal scrollback, browser history, or another repository.
Rotate anything that may have left the secure channel.
```

## 10. Blue Sync, Freshness, and Consistency

Aya syncs Blue data in three ways:

```text
Initial employee sync on Aya Copilot boot.
Initial workspace index sync on Aya Copilot boot.
Background polling when ENABLE_BLUE_POLLING=true.
Optional webhooks if BLUE_WEBHOOK_PUBLIC_URL and BLUE_WEBHOOK_SECRET are configured.
```

Default sync settings from Aya Copilot config:

```text
BLUE_INGEST_INTERVAL_MS=60000
WORKSPACE_FULL_RECONCILE_HOURS=6
BLUE_GRAPHQL_PAGE_SIZE=200
BLUE_GRAPHQL_MAX_CONCURRENCY=4
BLUE_GRAPHQL_RETRY_ATTEMPTS=5
BLUE_GRAPHQL_RETRY_BASE_MS=300
```

Interpretation:

```text
Polling defaults to about once per minute.
A full workspace reconcile defaults to every 6 hours.
Incremental cache updates happen between full reconciles.
Only one workspace index sync runs at a time; overlapping sync requests reuse the active sync.
Webhook updates can improve freshness if configured.
For any critical action, Blue remains the final source of truth.
```

Context and disambiguation behavior:

```text
LibreChat passes x-aya-conversation-id to Aya Copilot using {{LIBRECHAT_BODY_CONVERSATIONID}}.
Aya scopes recent record context, pending record choices, and copilot memory by employee plus conversation-scoped transport.
If LibreChat does not provide a conversation ID, Aya falls back to the base transport scope.
Broad or close client-name matches ask the user to choose a record instead of silently picking the top match.
Generic replies like "that one" do not select the first ambiguous candidate; users should answer with an option number or a specific title/detail.
```

Operational warning:

```text
If multiple employees move records directly in Blue and through Aya at the same time, Blue is authoritative. Aya should refresh through polling/webhooks, but the UI answer may lag slightly depending on API timing and cache freshness.
```

## 11. Memory and Context

Aya has local context/memory tables:

```text
active_record_context
pending_record_choices
copilot_memory
bot_audit_logs
blue_sync_state
```

What this enables:

```text
Follow-up commands can refer to the previous record.
Ambiguous record choices can be remembered briefly.
Recent interaction signals can improve answer continuity.
Audited tool calls can support manager activity questions.
```

What this does not mean:

```text
It is not a permanent employee surveillance system.
It is not a replacement for Blue history.
It should not store unnecessary customer-sensitive data beyond what is needed for operations.
```

## 12. Audit and Logging

Aya Copilot audit logs record tool activity and operational metadata.

Audit behavior:

```text
MCP tool calls are audited.
Employee identity is attached when resolved.
Blue write actions should be attributable to the requesting employee when per-user credentials are configured.
Production audit stdout mode defaults to metadata unless overridden.
```

Relevant setting:

```text
AUDIT_STDOUT_MODE=metadata
```

Avoid in production:

```text
AUDIT_STDOUT_MODE=full
```

Use full logging only during controlled debugging because it can expose request/response details.

## 13. CI/CD and Deployment

GitHub Actions workflow:

```text
.github/workflows/deploy.yml
```

Trigger:

```text
Push to main
```

Pipeline steps:

```text
Checkout code
Setup Node 22
Install Aya dependencies
Run Aya backend tests
Build Aya backend
Install LibreChat dependencies
Build LibreChat data-provider/data-schemas/client-package/API/client
Run LibreChat API tests
Run LibreChat client tests
Setup Go
Run blue-cli go test ./...
Run blue-cli go build ./...
SSH deploy to VPS
Run docker compose up -d --build
Check local Aya health
Check local LibreChat HTTP response
Run public production verification
```

Production verification script:

```text
scripts/verify_production.mjs
```

It checks:

```text
/ loads publicly
/health returns ok=true
health database.ok=true
health blueApi.ok=true
/api/config has appTitle AYA Copilot
email login enabled
registration enabled
social login disabled
Google login disabled
registration domain is ayafinancial.com when the public config exposes it
MCP UI enabled
aya-copilot-assistant model spec present
/login has no Google sign-in copy or Google OAuth route
/admin returns 404
/mcp and /mcp/hostinger reject unauthenticated requests
```

Manual production verification:

```bash
cd /Users/hparacha/AyaFinancial/Blue
node scripts/verify_production.mjs
```

## 14. Local Setup

Install and test Aya Copilot:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/copilot
npm ci
npm run check
npm test
npm run build
```

Run Aya Copilot locally:

```bash
cd /Users/hparacha/AyaFinancial/Blue/apps/copilot
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

Local safety checks:

```text
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
ALLOW_BOOTSTRAP_PROVISIONING=false
BLUE_WORKSPACE_ID=cmn524yr800e101mh7kn44mhf
```

## 15. Production Deployment

VPS repo location:

```text
~/Blue
```

Production deployment directory:

```text
~/Blue/apps/copilot/deploy/hostinger
```

Manual deploy command on VPS:

```bash
cd ~/Blue/apps/copilot/deploy/hostinger
docker compose up -d --build
```

Post-deploy local checks on VPS:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3010/health
curl -fsSI http://127.0.0.1:3080
```

Public checks from any machine:

```bash
curl -fsS https://copilot.ayafinancial.com/health
curl -fsS https://copilot.ayafinancial.com/api/config
node scripts/verify_production.mjs
```

Expected health shape:

```json
{
  "ok": true,
  "database": { "ok": true },
  "blueApi": { "ok": true }
}
```

Expected public config shape:

```json
{
  "appTitle": "AYA Copilot",
  "emailLoginEnabled": true,
  "registrationEnabled": true,
  "socialLoginEnabled": false,
  "googleLoginEnabled": false
}
```

## 16. Production Runtime Data

Persistent state lives under:

```text
apps/copilot/deploy/hostinger/data/aya
apps/copilot/deploy/hostinger/data/mongodb
apps/copilot/deploy/hostinger/data/meilisearch
apps/copilot/deploy/hostinger/data/librechat/uploads
apps/copilot/deploy/hostinger/data/librechat/logs
```

Do not commit anything under:

```text
apps/copilot/deploy/hostinger/data/
```

Backup recommendation:

```text
Back up MongoDB and Aya data before major upgrades.
Encrypt backups at rest.
Limit access to backup archives because they can contain chat history, user accounts, encrypted user variables, audit metadata, and Blue cache data.
```

## 17. Email-Safe Handoff Checklist

Before sending this to the next person:

```text
Confirm this document contains no real keys.
Send actual secrets separately through a password manager.
Confirm the recipient understands the allowed/forbidden Blue workspace IDs.
Confirm the recipient knows system fallback should stay disabled.
Confirm the recipient knows Google login is intentionally disabled.
Confirm the recipient knows /admin is intentionally removed.
Confirm the recipient knows Blue remains the source of truth.
Confirm the recipient knows to rotate any key shared outside a secure channel.
```

## 18. Operational Checklist for the Next Owner

First day checks:

```bash
cd /Users/hparacha/AyaFinancial/Blue
node scripts/verify_production.mjs
```

Then sign into:

```text
https://copilot.ayafinancial.com
```

Ask read-only questions first:

```text
what can you do for Aya Financial?
show my assignments
where have I been mentioned?
show recent comments on AYA SMOKE TEST - OpenAI gpt-4o-mini
```

Then verify write flow only on the smoke-test record:

```text
add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: handoff smoke test
```

If the bot asks for Blue credentials:

```text
Open Aya MCP server settings in LibreChat.
Enter personal Blue Token ID.
Enter personal Blue Token Secret.
Save.
Retry the write.
```

## 19. Common Failure Modes

Chat UI loads but cannot type:

```text
Check LibreChat build/container health.
Check browser console.
Check /api/config.
Check that the selected model spec exists.
```

Google button appears:

```text
Production auth regressed.
ALLOW_SOCIAL_LOGIN should be false.
Google login should be false in /api/config.
Run node scripts/verify_production.mjs.
```

User cannot sign up:

```text
Confirm email domain is ayafinancial.com.
Confirm ALLOW_REGISTRATION=true.
Confirm LibreChat config registration.allowedDomains includes ayafinancial.com.
```

Blue writes fail:

```text
Confirm the user's Blue Token ID and Secret are saved in LibreChat MCP settings.
Confirm ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false is expected.
Confirm BLUE_WORKSPACE_ID is cmn524yr800e101mh7kn44mhf.
Confirm /health blueApi.ok=true.
```

Assignments look stale or wrong:

```text
Check Blue directly first.
Check sync state and polling.
Run/schedule workspace index sync if needed.
Remember that Blue is source of truth and cache can lag.
```

Production deploy succeeded but public app is wrong:

```text
Run node scripts/verify_production.mjs.
Check GitHub Actions deployment logs.
Check docker compose ps on the VPS.
Check reverse proxy/tunnel config.
```

## 20. Known Security Review Findings From This Handoff Pass

Checked on May 11, 2026:

```text
AGENTS.md is present in GitHub.
Exact local Hostinger runtime env/config paths are ignored by .gitignore.
Exact local Hostinger runtime env/config paths had no Git history in this repo check.
Production verifier exists and passed previously after deployment.
MCP and Hostinger MCP use separate internal secrets.
The normal public app does not expose /admin.
Google/social login is expected to stay disabled.
```

Action required:

```text
Rotate the OpenAI key if it was pasted into chat or any non-secret channel.
Rotate Blue and Hostinger keys if they were pasted into chat or any non-secret channel.
Do not email actual secrets with this handoff.
```

## 21. Future Improvements

Product improvements:

```text
Make onboarding clearer with an in-app "Connect Blue" checklist.
Add better confirmation screens for write actions.
Add manager-ready natural-language reports for workload, overdue items, and recent activity.
Add underwriting file validation with human-in-the-loop review.
Add document intake workflows for credit-union/MOYA package preparation.
Add structured output for missing document lists, exceptions, and next-best actions.
```

Security improvements:

```text
SSO or enforced verified email before broad rollout.
Managed secrets instead of flat env files.
Regular key rotation schedule.
VPS non-root deployment user.
Firewall and SSH hardening review.
Formal backup/restore testing.
Dependency vulnerability scanning.
Rate limiting and lockout policies for auth.
Security review before connecting to production customer workflows.
```

## 22. Final Owner Notes

This chatbot is useful when it is treated as an operational copilot, not as an unchecked automation system.

Safe operating model:

```text
Use it for Blue lookup, summaries, assignment checks, comments, and simple approved actions.
Use personal Blue credentials for write attribution.
Keep Blue as the source of truth.
Keep humans in the loop for underwriting, credit union packages, customer-sensitive decisions, and irreversible workflow changes.
Keep secrets out of Git, email, screenshots, and chat.
```

## Final Owner Transfer Checklist

Use this section when Aya fully takes ownership and the original builder is no longer supporting the system.

### What The New Owner Must Receive

The new technical owner needs all of the following before they can safely maintain the chatbot:

```text
1. GitHub ownership or admin access for the repo.
2. Hostinger/VPS admin access.
3. SSH access to the VPS, or a Hostinger browser terminal fallback.
4. Production env files or the secret values needed to recreate them.
5. Blue system integration credentials.
6. Instructions for every employee to add their personal Blue API credentials in LibreChat.
7. OpenAI API key ownership/billing access.
8. DNS/reverse-proxy ownership for copilot.ayafinancial.com.
9. Backup access or the ability to create VPS snapshots.
10. This handoff document.
```

Do not assume repo transfer alone is enough. The repo does not contain production secrets, runtime databases, uploaded files, or Hostinger state.

### Current Production Runtime

Production URL:

```text
https://copilot.ayafinancial.com
```

Current VPS:

```text
Hostinger VPS IP: 187.77.21.222
SSH user used during buildout: root
Server checkout path: /root/Blue
Deployment directory: /root/Blue/apps/copilot/deploy/hostinger
```

Docker services:

```text
librechat              employee-facing chat app and LibreChat API
aya-copilot            Aya business logic, MCP tools, Blue routing, audit, sync
aya-chat-mongodb       LibreChat database
aya-chat-meilisearch   LibreChat search/index service
```

Useful server commands:

```bash
ssh root@187.77.21.222
cd /root/Blue/apps/copilot/deploy/hostinger

docker compose ps
docker compose logs --tail=100 aya
docker compose logs --tail=100 librechat
docker compose up -d --build aya
docker compose restart librechat
```

Health checks:

```bash
curl http://127.0.0.1:3010/health
curl -I http://127.0.0.1:3080
```

Local repo production verification:

```bash
node scripts/verify_production.mjs
```

### Where The Actual Secret Values Are

Secret values are intentionally not in GitHub and should not be pasted into this document.

Current production secret files live on the VPS here:

```text
/root/Blue/apps/copilot/deploy/hostinger/env/aya.env
/root/Blue/apps/copilot/deploy/hostinger/env/librechat.env
/root/Blue/apps/copilot/deploy/hostinger/config/librechat.yaml
```

Example templates in GitHub:

```text
apps/copilot/deploy/hostinger/env/aya.env.example
apps/copilot/deploy/hostinger/env/librechat.env.example
apps/copilot/deploy/hostinger/config/librechat.yaml.example
```

To show only the variable names on the VPS without exposing values:

```bash
cd /root/Blue/apps/copilot/deploy/hostinger
cut -d= -f1 env/aya.env | sed '/^#/d;/^$/d'
cut -d= -f1 env/librechat.env | sed '/^#/d;/^$/d'
```

To transfer the real values, use a password manager, encrypted note, or approved secure channel. Do not commit them. Do not paste them into Slack, GitHub issues, or this handoff file.

### Required Aya Copilot Env Values

`env/aya.env` controls the custom Aya backend.

Required production values:

```text
NODE_ENV=production
PORT=3010
AYA_DATA_DIR=/app/data
LOG_LEVEL=info
AUDIT_STDOUT_MODE=metadata
ENABLE_BLUE_POLLING=true
ALLOW_DEV_DEFAULT_ACTOR=false
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
ALLOW_BOOTSTRAP_PROVISIONING=false
AYA_MCP_API_KEY=<shared internal key used by LibreChat to call Aya MCP>
AYA_HOSTINGER_MCP_API_KEY=<separate internal key for Hostinger/infra MCP surface>
BLUE_WORKSPACE_ID=<Blue workspace ID Aya is allowed to use>
BLUE_API_URL=https://api.blue.cc/graphql
BLUE_AUTH_TOKEN=<Blue system token>
BLUE_CLIENT_ID=<Blue client ID/token ID depending on Blue credential format>
BLUE_COMPANY_ID=<Blue company/account ID>
BLUE_WEBHOOK_PUBLIC_URL=https://copilot.ayafinancial.com/webhooks/blue
BLUE_WEBHOOK_SECRET=<shared webhook signing secret if webhooks are enabled>
LIBRECHAT_MONGO_URI=mongodb://mongodb:27017/LibreChat
LIBRECHAT_MONGO_DB_NAME=LibreChat
```

Important production defaults:

```text
ALLOW_SYSTEM_BLUE_WRITE_FALLBACK=false
ALLOW_DEV_DEFAULT_ACTOR=false
ALLOW_BOOTSTRAP_PROVISIONING=false
```

If these are changed to `true` in production, security and write attribution become weaker. Do not do that without a deliberate engineering decision.

### Required LibreChat Env Values

`env/librechat.env` controls LibreChat login, OpenAI access, encryption keys, JWTs, Meili, and registration behavior.

Required production values:

```text
HOST=0.0.0.0
PORT=3080
DOMAIN_CLIENT=https://copilot.ayafinancial.com
DOMAIN_SERVER=https://copilot.ayafinancial.com
APP_TITLE=AYA Copilot
AYA_MCP_API_KEY=<must match env/aya.env AYA_MCP_API_KEY>
NO_INDEX=true
TRUST_PROXY=1
CONSOLE_JSON=true
DEBUG_LOGGING=false
DEBUG_CONSOLE=false
ENDPOINTS=openAI
OPENAI_API_KEY=<OpenAI project API key>
CREDS_KEY=<64 hex chars>
CREDS_IV=<32 hex chars>
JWT_SECRET=<64 hex chars>
JWT_REFRESH_SECRET=<64 hex chars>
MEILI_MASTER_KEY=<64 hex chars>
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_SOCIAL_REGISTRATION=false
ALLOW_PASSWORD_RESET=false
ALLOW_UNVERIFIED_EMAIL_LOGIN=true
MONGO_URI=mongodb://mongodb:27017/LibreChat
```

Google login is currently not required. If Aya later enables Google login, then these also need valid Google OAuth values:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALLBACK_URL=/oauth/google/callback
```

The Google redirect URI must be:

```text
https://copilot.ayafinancial.com/oauth/google/callback
```

### How To Generate Replacement LibreChat Secrets

If the new owner rebuilds env files from scratch, generate fresh values on the VPS:

```bash
openssl rand -hex 32  # 64 hex chars for CREDS_KEY, JWT_SECRET, JWT_REFRESH_SECRET, MEILI_MASTER_KEY
openssl rand -hex 16  # 32 hex chars for CREDS_IV
```

Do not rotate these casually on an active system. Rotating encryption/JWT-related values can invalidate sessions or make stored encrypted credentials unreadable.

### OpenAI API Key

LibreChat uses OpenAI through:

```text
OPENAI_API_KEY in env/librechat.env
```

The handoff owner should either:

```text
1. Take ownership of the existing OpenAI project/key through the Aya-controlled OpenAI account, or
2. Create a new Aya-owned OpenAI project API key and replace OPENAI_API_KEY in env/librechat.env.
```

After changing the key:

```bash
cd /root/Blue/apps/copilot/deploy/hostinger
docker compose restart librechat
node /root/Blue/scripts/verify_production.mjs
```

If `node /root/Blue/scripts/verify_production.mjs` is not available on the VPS, run it from a local checkout with network access.

### Blue System Credentials

Aya Copilot needs system-level Blue credentials in `env/aya.env` for background sync, health checks, indexing, and read paths:

```text
BLUE_AUTH_TOKEN
BLUE_CLIENT_ID
BLUE_COMPANY_ID
BLUE_WORKSPACE_ID
BLUE_API_URL
```

The current real values are on the VPS in:

```text
/root/Blue/apps/copilot/deploy/hostinger/env/aya.env
```

If those values are lost, the new owner must create or retrieve Blue API credentials from an Aya-controlled Blue admin/service account. Use a dedicated integration/service account where possible, not a personal employee account.

The current workspace ID is:

```text
cmn524yr800e101mh7kn44mhf
```

If the team moves from the pilot workspace to the real production workspace, follow the workspace migration process earlier in this document. Do not only change `BLUE_WORKSPACE_ID`; update the code guardrails, `AGENTS.md`, and this handoff.

### Employee Personal Blue API Credentials

For attributable write actions, each employee should connect their own Blue credentials inside LibreChat.

Employee steps:

```text
1. Log into Blue.
2. Open profile/account settings.
3. Open the API/token section.
4. Create or copy the Blue Token ID and Blue Token Secret.
5. Log into copilot.ayafinancial.com.
6. Open MCP/Aya Copilot server settings in LibreChat.
7. Paste Blue Token ID into AYA_BLUE_TOKEN_ID.
8. Paste Blue Token Secret into AYA_BLUE_TOKEN_SECRET.
9. Save/initialize the Aya Copilot connection.
10. Test with a harmless read prompt first, then one smoke-test write.
```

Why this matters:

```text
Reads can use the system Blue credentials.
Writes should use the employee's personal Blue token so actions are attributable and permissioned.
The app has production fallback disabled, so write actions should not silently use a shared system token.
```

Recommended employee first prompts:

```text
who am I signed in as?
show my assignments
what am I working on?
latest comments on AYA SMOKE TEST - OpenAI gpt-4o-mini
```

Recommended employee write test:

```text
add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: <employee name> handoff write test
```

### User Signup And Account Security

Signup is configured for Aya emails only through LibreChat config:

```text
registration.allowedDomains:
  - ayafinancial.com
```

LibreChat admin signup is controlled by an explicit env allowlist:

```text
AYA_LIBRECHAT_ADMIN_EMAILS=hamza@ayafinancial.com,rsaeed@ayafinancial.com,skhan@ayafinancial.com
```

When this variable is set, only listed emails become LibreChat `ADMIN` users during signup. All other Aya-domain signups become normal `USER` accounts. This prevents an unapproved employee from becoming admin merely because they are the first person to register in a freshly reset Mongo database.

Expected behavior:

```text
@ayafinancial.com signup: allowed
non-Aya signup: rejected
Google login: disabled unless intentionally re-enabled
password reset: disabled unless SMTP/reset flow is intentionally configured
LibreChat admin: only emails listed in AYA_LIBRECHAT_ADMIN_EMAILS
```

LibreChat stores user passwords hashed with bcrypt. Plaintext passwords are not stored in MongoDB.

### Major Handoff Item: Password Reset Email

Password reset is currently not production-complete unless Aya provides an outbound email sender.

LibreChat already includes the forgot-password UI and reset-token backend, but it needs email delivery configured before users can recover accounts themselves.

Required production decision:

```text
Choose one approved email provider for reset links:
- Google Workspace SMTP
- SendGrid
- Mailgun
- another Aya-approved transactional email provider
```

Required environment shape:

```text
ALLOW_PASSWORD_RESET=true
EMAIL_FROM_NAME=Aya Copilot
EMAIL_FROM=copilot@ayafinancial.com

# SMTP option
EMAIL_HOST=<smtp host>
EMAIL_PORT=587
EMAIL_ENCRYPTION=starttls
EMAIL_USERNAME=<smtp username>
EMAIL_PASSWORD=<smtp password or app password>

# Or Mailgun option
MAILGUN_API_KEY=<mailgun api key>
MAILGUN_DOMAIN=<mailgun domain>
```

Until this is configured, existing users who forget passwords must be reset manually by an operator with VPS/Mongo access, or the environment must be intentionally reset before go-live.

LibreChat runtime data lives in MongoDB:

```text
/root/Blue/apps/copilot/deploy/hostinger/data/mongodb
```

Do not delete or edit MongoDB directly unless you know exactly what you are doing.

Aya Copilot role data lives separately in SQLite:

```text
/root/Blue/apps/copilot/deploy/hostinger/data/aya
```

If employee admin privileges look wrong inside chatbot tools, check the Copilot `employees.role_name` values as well as LibreChat Mongo users. Mongo controls LibreChat accounts and UI roles; Aya SQLite controls Copilot tool roles.

### Demo Account

A demo/smoke account may exist for handoff testing:

```text
hamza.test@ayafinancial.com
```

Do not put the password in GitHub or this document. If the new owner needs this account, send the password through a secure channel or reset it after handoff.

### Backups

Back up these directories before making major changes:

```text
/root/Blue/apps/copilot/deploy/hostinger/data/aya
/root/Blue/apps/copilot/deploy/hostinger/data/mongodb
/root/Blue/apps/copilot/deploy/hostinger/data/meilisearch
/root/Blue/apps/copilot/deploy/hostinger/data/librechat/uploads
/root/Blue/apps/copilot/deploy/hostinger/env
/root/Blue/apps/copilot/deploy/hostinger/config
```

Minimum backup method:

```text
Hostinger VPS snapshot before upgrades or risky config changes.
```

Better backup method:

```text
Scheduled encrypted backups of deploy/hostinger/data plus env/config files to Aya-controlled storage.
```

### Current Validation Status As Of May 11, 2026

Validated before handoff:

```text
Production URL loads.
LibreChat login surface works.
Aya Copilot health endpoint works.
LibreChat config check passes.
Old custom admin surface is removed.
Unauthenticated /api/user is blocked.
Public /mcp and /mcp/hostinger are blocked without the internal key.
Non-Aya email signup is blocked.
Aya-domain signup works.
Temporary signup smoke account was removed after testing.
Core chatbot read prompts work.
Sarah/Rehan workload prompts work.
Team overdue prompt works.
Record summary and recent activity prompts work.
8 simultaneous authenticated read-only chat sessions passed.
Aya Copilot npm audit reports 0 vulnerabilities.
Aya Copilot focused tests pass.
Aya Copilot TypeScript build passes.
```

Useful validation commands:

```bash
node scripts/verify_production.mjs
npm --prefix apps/copilot test -- tests/router/intents.test.ts tests/modules/disambiguation/record-choices.test.ts
npm --prefix apps/copilot run build
npm --prefix apps/copilot audit --audit-level=high
node scripts/librechat_demo_smoke.mjs --base-url=https://copilot.ayafinancial.com --json "show my assignments" "what is Sarah working on?" "who is overdue?"
```

### Known Maintenance Caveat

Aya Copilot dependencies were patched and deployed with zero npm audit vulnerabilities.

LibreChat is an upstream third-party app and still has dependency advisories in its dependency tree. A safe `npm audit fix` was attempted, but it broke the local LibreChat build, so the LibreChat lockfile change was not kept or deployed.

The next technical owner should plan a controlled LibreChat upgrade rather than running `npm audit fix --force` blindly in production.

Recommended process for LibreChat upgrade:

```text
1. Create a branch.
2. Upgrade LibreChat dependencies or bump LibreChat to a newer upstream release.
3. Run build:packages and build:client locally.
4. Run LibreChat API/client tests if time allows.
5. Build the Hostinger Docker stack locally or on staging.
6. Test login, chat, Aya MCP initialization, and the demo smoke prompts.
7. Snapshot the VPS.
8. Deploy during a low-usage window.
9. Keep rollback instructions ready.
```

### Post-Handoff Ownership Statement

After repo and VPS transfer, Aya or its appointed technical owner is responsible for:

```text
server uptime
VPS access
DNS and TLS/reverse proxy
OpenAI billing and key rotation
Blue API credentials
employee account onboarding/offboarding
backups and restores
security updates
LibreChat upgrades
Blue workspace migration if needed
monitoring logs after changes
```

The system should be handed off as a working controlled rollout, not as a maintenance-free product.
