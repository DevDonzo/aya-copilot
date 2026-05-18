# Aya Copilot Production Hardening Checklist

This is the dev handoff for the next production-hardening pass. Do not change the core agent architecture: MCP plus the Vercel AI SDK agent loop is the right direction. Focus on security, freshness, and deployment hygiene.

## 1. Require personal Blue credentials before any CRM access

Personal Blue Token ID and Token Secret must gate all sensitive CRM access, not only writes.

New rule:

- If a user has not provided both Blue Token ID and Blue Token Secret through LibreChat MCP user vars, Aya must not allow CRM reads, searches, summaries, comments, workload, reporting, or writes.
- The only allowed behavior without personal Blue credentials should be identity/help text, instructions for connecting Blue credentials, and non-sensitive generic assistant responses.
- Aya Financial email sign-in proves identity, not Blue data authorization.

Implementation guidance:

- In the MCP path, require `x-aya-blue-token-id` and `x-aya-blue-token-secret` before `aya_message` can execute any CRM-capable flow.
- In the HTTP `/messages` path, require `actorBlueTokenId` and `actorBlueTokenSecret` or equivalent headers before handling CRM-capable requests.
- In the agent tool policy, add a policy flag such as `requiresBlueAuth?: boolean`.
- Mark all CRM/reporting/data tools as requiring Blue auth:
  - `searchClients`
  - `getClientDetail`
  - `getClientComments`
  - `getEmployeeDailyBrief`
  - `getEmployeeDaySummary`
  - `getEmployeeWorkload`
  - `getEmployeeFollowUpQueue`
  - `getEmployeeAssignments`
  - `getEmployeeNotifications`
  - team/admin reporting tools
  - all write tools
- Keep `getSignedInUser` and `respondDirectly` allowed without Blue auth.
- Update old planner/fallback execution too, otherwise fallback could bypass the new rule.

Expected user-facing message:

```txt
Connect your Blue account before using Aya with CRM data. Open the Aya MCP server settings and enter both your Blue Token ID and Blue Token Secret, then try again.
```

Add tests for:

- no Blue credentials blocks CRM search
- no Blue credentials blocks employee summaries
- no Blue credentials blocks admin reports
- no Blue credentials blocks writes
- no Blue credentials still allows current identity/help
- fallback planner cannot bypass the Blue credential gate

## 2. Lock down summary HTTP routes

`apps/copilot/src/routes/summaries.ts` is weaker than the agent policy.

Change:

- `/summary/day`: employees can only request their own summary.
- `/summary/team`: admin-only.
- other employee summaries: admin-only.

Add tests for:

- employee can access own summary
- employee cannot access another employee summary
- employee cannot access team summary
- admin can access team summary
- admin can access another employee summary

## 3. Harden auth

In `apps/copilot/src/auth/service.ts` and `apps/copilot/src/routes/auth.ts`:

- Add login rate limiting.
- Add failed-login tracking.
- Add lockout/backoff after repeated failures.
- Audit failed login attempts.
- In production, cookies should default to `secure: true`.

Current cookie logic can return insecure cookies in production if proxy headers are missing. Production should default secure, with explicit local/dev exceptions only.

## 4. Stop leaking raw 500 errors

In `apps/copilot/src/app/plugins/error-handler.ts`, production 500 responses should return a generic message:

```txt
Internal server error
```

Keep the actual error in server logs only.

## 5. Add Blue GraphQL timeouts

In `apps/copilot/src/modules/blue/graphql/client.ts`, add per-request timeout/abort handling around `fetch`.

Use `AbortSignal.timeout(...)` or equivalent, configurable by env, so hung Blue requests do not block queue slots forever.

## 6. Make webhooks primary and polling reconciliation-only

The webhook architecture already exists. Keep it.

Change the poller posture:

- Treat `blue-poller.ts` as a reconciler.
- Keep initial boot sync.
- Use Blue webhooks as the primary freshness path.
- Change default `BLUE_INGEST_INTERVAL_MS` from `60_000` to something like `3_600_000`.
- Keep hourly reconciliation to catch missed webhooks.
- Add health/status fields for:
  - last webhook received
  - last reconciliation
  - webhook registration status

In production env/docs, make `BLUE_WEBHOOK_PUBLIC_URL` effectively required.

## 7. Use live Blue reads for specific client lookups

Avoid answering specific client/file questions from stale cache when correctness matters.

Preferred split:

- Use live Blue API reads for specific record/detail/search questions, such as "where is Smith?", "comments on Smith", "what stage is this client in?", and direct client/file lookups.
- Use the SQLite cache for broad reports, summaries, workload, team dashboards, and expensive aggregate views.
- Keep webhooks updating the cache for fast follow-up behavior.
- Keep hourly reconciliation as a safety net.

The goal is: live and correct for one-record user questions, cached and fast for broad reporting.

## 8. Optimize workspace sync after webhook-first freshness is in place

`syncWorkspaceIndexInternal` currently fetches lists and then fetches records per list. This is acceptable as a reconciliation fallback, but it can become expensive as the workspace grows.

Do not prioritize this ahead of credential/RBAC/webhook work unless sync is already timing out.

After webhook-first freshness is working:

- Check whether Blue supports a workspace-level paginated records query.
- Prefer one paginated record query, or a small number of "fat" queries, over one query per list.
- Keep per-list sync only if Blue's API requires it.
- Keep concurrency and retry limits conservative to avoid rate limits.

## 9. Back up persistent data

SQLite is fine for a 10-person internal tool, but it must be backed up.

Add a simple production backup job for:

- Aya SQLite database
- LibreChat MongoDB data
- any uploaded files/logs needed for operational recovery

Acceptable targets include S3, Cloudflare R2, Backblaze B2, or VPS snapshots. The backup should run nightly at minimum and should have a documented restore test.

## 10. Improve user-facing failure messages

Do not expose stack traces or internal implementation details, but make common failures actionable.

Examples:

```txt
Your Blue token is missing or expired. Open Aya MCP settings and reconnect your Blue Token ID and Secret, then try again.
```

```txt
I could not reach Blue right now. Try again in a minute. If this keeps happening, ask an admin to check Aya's Blue connection.
```

Avoid vague responses like:

```txt
The action failed before Aya could complete it.
```

Where possible, distinguish:

- missing Blue credentials
- expired/invalid Blue credentials
- permission denied
- Blue API unavailable
- ambiguous client/file
- ambiguous employee
- blocked bulk action

## 11. Keep MCP architecture, but centralize MCP policy

MCP is the right architecture. Keep `aya_message` as the default tool.

If specialist MCP tools are ever exposed with `AYA_MCP_EXPOSE_SPECIALIST_TOOLS=true`, their RBAC must match the agent policy.

Review `apps/copilot/src/mcp/server.ts`, especially:

- employee workload
- follow-up queue
- day summary
- assignments
- reporting tools

Every employee-scoped tool should be self-only unless admin. Every team/reporting tool should be admin-only.

Best fix: reuse the same policy logic as `apps/copilot/src/modules/copilot/agent/policy.ts` instead of duplicating checks.

## 12. LibreChat deployment hygiene

For production, do not rely on the root `apps/librechat/docker-compose.yml`.

That file has dev-grade defaults:

- `librechat-dev:latest`
- `mongod --noauth`
- default Postgres credentials

Production should use the Hostinger compose path or a hardened production compose with pinned images, authenticated databases, and server-managed secrets.

Keep `librechat.yaml` as config, but inject production secrets through deployment environment variables or the server's secret-management setup.

## 13. Move runtime data out of the repo tree

Move runtime data out of:

```txt
apps/copilot/deploy/hostinger/data/
```

Use a server-owned location such as:

```txt
/srv/aya/data/
/srv/aya/mongodb/
/srv/aya/logs/
```

Keep backups and permissions managed outside Git.

## 14. Keep planner fallback as rollback only, then delete old planner paths

The agent path is now strong. Use `AYA_CHAT_RUNTIME=agent` for normal operation and keep `agent_with_planner_fallback` only as a rollback setting until old planner paths are deleted.

Before deleting planner files, verify live usage for:

- agent misses
- fallback frequency
- tool errors
- clarification behavior
- write credential failures
- admin policy blocks

After a short production observation window, remove the old planner paths if fallback usage is zero or fully understood:

- `planner.ts`
- `llm-planner.ts`
- old planner execution branches in `service.ts`

The goal is one maintained runtime. Do not keep regex planner, JSON planner, and agent planner alive indefinitely.

## Summary

The agent/MCP/LibreChat architecture is good. The remaining work is production hardening:

- personal Blue credential gate
- route RBAC
- secure cookies
- login rate limits
- generic production errors
- Blue request timeouts
- webhook-first freshness
- live Blue reads for specific client lookups
- persistent data backups
- clearer actionable user errors
- deployment hygiene
