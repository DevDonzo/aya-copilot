# Aya Copilot Final Handoff

This is the clean operational handoff for Aya Financial's Blue CRM copilot stack.

Use this after the production-hardening work in `docs/internal/fix.md` is complete and before handing ownership to the next maintainer.

## What This System Is

Aya Copilot is an internal chatbot for Aya Financial staff. It lets employees and managers ask operational questions about Blue CRM, client files, comments, assignments, follow-ups, and activity.

The stack has three main surfaces:

- `apps/librechat`: employee chat UI
- `apps/copilot`: Aya backend, MCP server, Blue integration, auth, policy, audit, and sync
- `tools/blue-cli`: low-level Blue API CLI for maintenance and investigation

## Current Architecture

```txt
Employee
  -> LibreChat
    -> Aya MCP server
      -> Aya Copilot backend
        -> Vercel AI SDK agent
        -> policy/RBAC layer
        -> Blue GraphQL
        -> SQLite audit/cache

LibreChat
  -> MongoDB
  -> Meilisearch
```

MCP is the bridge between LibreChat and Aya Copilot. Keep this architecture.

## Core Runtime Recommendation

Use this during handoff:

```txt
AYA_CHAT_RUNTIME=agent_with_planner_fallback
```

The AI SDK agent should handle normal traffic first. The old planner is only a safety net during the handoff window.

Current cleanup decision:

- Keep `AYA_CHAT_RUNTIME=agent_with_planner_fallback` for the first production observation window.
- Local audit inspection found no `ai-sdk-agent` rows with `outcome='fallback'` in `apps/copilot/data/aya-ops-bot.sqlite`.
- Do not delete `planner.ts` or `llm-planner.ts` until production audit logs for the deployed hardened build also show zero fallback usage, or every fallback case is explicitly ported to an agent tool.
- If fallback appears for important workflows, keep it temporarily and document the specific prompts/intents that still need porting.

After the final deep-dive test and a short production observation window:

```txt
AYA_CHAT_RUNTIME=agent
```

Then remove:

- `apps/copilot/src/modules/copilot/planner.ts`
- `apps/copilot/src/modules/copilot/llm-planner.ts`
- old planner execution branches in `apps/copilot/src/modules/copilot/service.ts`

Do not keep regex planner, JSON planner, and AI SDK agent paths alive indefinitely.

## Security Model

Email sign-in identifies the employee. It must not be treated as enough authorization for Blue CRM data.

The required model is:

- LibreChat signs the user in.
- Aya resolves the employee identity.
- The employee must enter personal Blue Token ID and Blue Token Secret in the Aya MCP settings before any CRM read, report, summary, comment, or write.
- Admin role controls team-level and other-employee reporting.
- Bulk destructive requests are always blocked.
- All sensitive reads/writes should be audited.

Allowed without Blue credentials:

- signed-in identity/help
- instructions for connecting Blue credentials
- non-sensitive generic assistant responses

Blocked without Blue credentials:

- client search
- client detail
- comments
- workload
- follow-up queues
- employee summaries
- team/admin reports
- all Blue writes

## Workspace Guardrails

Allowed Blue workspace:

- name: `03 - AYA x Hamza/ AI`
- ID: `cmn524yr800e101mh7kn44mhf`

Forbidden Blue workspace:

- name: `AYA sales CRM 3`
- ID: `cmhazc4rl1vkand1eonnmiyjy`

Do not remove or weaken these guardrails unless Aya explicitly approves a workspace cutover. A cutover must update code, docs, and environment configuration together.

## Key Files

- `docs/internal/fix.md`: production-hardening checklist for the dev to complete
- `docs/internal/final-deep-dive-test.md`: final QA and handoff test runbook
- `apps/copilot/src/modules/copilot/agent/`: AI SDK agent runtime, policy, tool registry, prompts
- `apps/copilot/src/mcp/server.ts`: Aya MCP server exposed to LibreChat
- `apps/copilot/src/modules/copilot/service.ts`: inbound message orchestration and fallback behavior
- `apps/copilot/src/modules/blue/graphql/client.ts`: Blue API client
- `apps/copilot/src/modules/blue/webhooks/service.ts`: Blue webhook verification and cache repair
- `apps/copilot/src/jobs/blue-poller.ts`: reconciliation job
- `apps/copilot/deploy/hostinger/`: single-VPS deployment bundle
- `docs/deployment-guide.md`: deployment procedure

## LibreChat Notes

LibreChat is the employee-facing UI. Aya Copilot should stay hidden behind the single Aya assistant experience.

Keep:

- `aya_message` as the default MCP tool
- personal Blue credential fields in the Aya MCP connection settings
- model/tool plumbing hidden from normal users

Do not use the root `apps/librechat/docker-compose.yml` as production deployment truth. Use the hardened Hostinger deployment path or an equivalent production compose.

## Webhook and Cache Model

Target behavior:

- Blue webhooks are the primary freshness path.
- Initial boot sync populates baseline data.
- Reconciliation runs hourly or similar, not every minute.
- Specific client/file questions should prefer live Blue reads or webhook-fresh data.
- Broad team summaries and reports may use cached/indexed data.

This avoids "fast but stale" answers for one-client questions while keeping broad reporting fast enough.

## Backups

The next owner must maintain backups for:

- Aya SQLite database
- LibreChat MongoDB data
- uploads or logs required for recovery

Backups should run nightly at minimum. A restore test should be documented and performed before final acceptance.

## Final Validation Order

1. Complete `docs/internal/fix.md`.
2. Run `docs/internal/final-deep-dive-test.md`.
3. Keep `AYA_CHAT_RUNTIME=agent_with_planner_fallback` during the first production observation window.
4. Monitor audit logs for:
   - agent successes
   - fallback usage
   - tool errors
   - permission blocks
   - missing/invalid Blue credential blocks
5. Port or remove any remaining fallback-only behavior.
6. Switch to `AYA_CHAT_RUNTIME=agent`.
7. Delete old planner paths.

## Final Deep-Dive Status

Automated and local checks cover the hardening behavior that can be verified without real production employee Blue credentials:

- TypeScript, unit, integration, build, and production-surface checks should pass before deployment.
- No-Blue-credential CRM gates are covered by tests for searches, summaries, admin reports, writes, fallback bypass, MCP policy, and direct record routes.
- Summary route RBAC, login lockout/audit, secure production cookies, generic production 500s, Blue GraphQL timeouts, and authenticated Mongo deployment scripts are covered by code/tests or script syntax checks.
- Production health/login/MCP protection can be checked with `node scripts/verify_production.mjs`.

Manual checks still required after deploy:

- A normal employee with valid personal Blue Token ID and Secret can search/read only permitted data.
- A valid credential write is attributed through that employee's Blue token.
- A non-admin cannot read another employee or team report.
- An admin can read team/employee reports.
- Blue webhook freshness updates a moved test record before hourly reconciliation.
- Backup artifacts are copied off-VM and restored into a temporary location.
- Production audit logs show agent successes, tool errors, permission blocks, missing/invalid Blue credential blocks, and any fallback usage.

## Repo Cleanup Classification

`docs/internal/handoff.md` is the source of truth for handoff state. Old email drafts under `docs/internal/communications/` are deleted and should not be reintroduced.

Classify `scripts/` this way:

- Keep: `verify_production.mjs` for production smoke checks.
- Keep: `librechat_demo_smoke.mjs` for local/demo chat smoke testing.
- Keep: `bootstrap_aya_demo_identity.mjs` for explicit demo identity bootstrap only.
- Keep: `blue_activity.sh` for allowed-workspace Blue activity inspection.
- Keep: `export_blue_live_schema.py` and `export_blue_api_docs.py` for regenerating `reference/` material.
- Archive candidate: `add_blue_mcp_to_claude_code.sh`, because it is a local Claude Code convenience helper, not product runtime.
- Archive candidate: `run_blue_mcp.sh`, because it is a local MCP debugging helper, not product runtime.
- Archive candidate: `make_api.sh`, unless Make.com remains an active integration dependency.
- Delete now: none without owner confirmation.

Classify `tools/blue-cli` as an active utility:

- Keep the Go source, `schema.graphql`, README, and tests. The CLI is still useful for low-level Blue API inspection, schema work, and maintenance outside the chatbot.
- Treat `tools/blue-cli/demo-builder` as an archive/delete candidate because it is a checked-in compiled binary. Confirm it is unused before deleting it.
- Do not delete `tools/blue-cli` or reference docs blindly.

## Handoff Acceptance Criteria

The system is ready to hand off when:

- TypeScript and test suites pass.
- No CRM data is accessible without personal Blue credentials.
- Non-admin users cannot access other employee/team data.
- Blue writes require personal Blue credentials.
- Bulk destructive requests are blocked.
- Webhooks update specific client state quickly.
- Reconciliation catches missed webhook events.
- User-facing errors are actionable.
- Audit logs capture important reads, writes, blocks, and failures.
- Backups exist and restore has been tested.
- Planner fallback usage is monitored and has a deletion plan.

## What Not To Do

- Do not reintroduce handoff email drafts into the repository.
- Do not put temporary handoff notes at the repo root.
- Do not expose specialist MCP tools broadly unless their RBAC matches the agent policy.
- Do not rely on Aya email-domain sign-in alone for CRM authorization.
- Do not remove workspace guardrails casually.
- Do not keep three message runtimes alive forever.
