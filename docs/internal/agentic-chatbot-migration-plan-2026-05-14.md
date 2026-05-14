# Agentic Chatbot Migration Plan - 2026-05-14

## Executive Summary

The current Aya chatbot has a strong action layer and a weak decision layer.

The good part is already in place:

- `apps/copilot/src/modules/copilot/actions.ts` contains useful Blue/Aya business operations.
- The GraphQL client, workspace cache, employee identity, audit store, and safety checks are real integration work.
- The system already has tests around identity, permissions, records, comments, audit reporting, and bulk-destructive safety.

The weak part is the planner:

- `planner.ts` is mostly regex intent matching.
- `llm-planner.ts` currently asks an LLM to output JSON plans, but the product still behaves like a router because the service layer wants a classified intent and parameters.
- The bot feels CLI-like because the model is not actually choosing tools, observing tool results, and continuing.

The target architecture is a real tool-calling agent:

- Define a safe tool registry over the existing `actions.ts` functions.
- Give the LLM tool descriptions and Zod schemas.
- Let the LLM call tools directly through the Vercel AI SDK.
- Keep policy, permissions, workspace safety, write credentials, and audit logging deterministic in TypeScript.
- Use the old planner only as a temporary fallback during migration.
- Remove the regex planner after QA parity is proven.

This plan is written so it can be pasted into `/plan` and executed phase by phase.

## Is Vercel AI SDK Free?

Short answer: the SDK package is free/open source; model usage is not free in general.

Current understanding from official sources:

- The Vercel AI SDK is a free/open-source TypeScript SDK. The public repository describes it as a free open-source library for building AI applications and agents: https://github.com/vercel/ai
- Vercel AI Gateway is a paid usage product with a free monthly credit tier. Vercel's AI Gateway pricing docs say team accounts receive $5 of free usage per month after first AI Gateway request, and paid usage is based on upstream provider list prices with no markup: https://examples.vercel.com/docs/ai-gateway/pricing
- The AI Gateway page also says BYOK has 0 percent markup from Vercel, but the upstream provider still charges for model tokens: https://vercel.com/ai-gateway

Practical decision for Aya:

- We can use the Vercel AI SDK without moving hosting to Vercel.
- We can initially use the existing `OPENAI_API_KEY` through `@ai-sdk/openai`, so there is no new Vercel AI Gateway dependency.
- AI Gateway can be added later if Aya wants unified model routing, usage tracking, model failover, and Vercel-managed credits.
- The SDK does not make LLM calls free. Every production chat request that uses a paid model still has token cost.

## Non-Negotiable Product Requirements

The new agent must feel like an LLM while staying safe around Blue.

It must:

- Understand natural requests without needing every phrasing encoded as regex.
- Run multi-step workflows, such as "find AYA SMOKE TEST, summarize comments, then tell me the next follow-up."
- Ask natural clarification questions when tool results are ambiguous.
- Preserve signed-in user context.
- Use conversation memory for active record follow-ups.
- Enforce role permissions before reading another employee's data.
- Refuse bulk destructive actions before credential checks.
- Never modify the forbidden Blue workspace.
- Never perform writes against an unspecified workspace.
- Require personal Blue write credentials for writes unless an explicit system fallback is enabled for a controlled non-production environment.
- Audit every tool call and user-visible response.
- Avoid leaking Blue tokens, OpenAI keys, internal prompts, or raw stack traces.

## Current Local Retest State

Source report:

- `docs/internal/local-chatbot-retest-2026-05-14.md`

Passed locally:

- Admin team overdue routing.
- Admin team summary.
- Multi-step `AYA SMOKE TEST` comments and next action.
- Call prep from `AYA SMOKE TEST` search.
- Rehan typo repair.
- Smoke-test alias comments.
- Comment activity report.
- No-assignee drill-down.
- Employee named-notification permission.
- Active record memory in same conversation.
- Bulk destructive safety.

Still failing locally:

1. Missing-phone reports include records with visible phone numbers in title/details.
2. Missing-email reports include records with visible email addresses in title/details.
3. Comment write prompt did not route:

```text
add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14
```

Expected behavior for comment write prompt:

- If no actor Blue write credentials are present, return the personal Blue credential requirement message.
- If credentials are present, add the note to only the allowed workspace and audit it.

## Migration Principle

Do not delete the old router first.

The correct migration order is:

1. Fix the remaining local QA failures on the current code.
2. Add an agentic tool-calling runtime beside the current planner.
3. Run both paths under tests.
4. Flip local/dev to the tool-calling runtime behind a feature flag.
5. Validate every QA prompt.
6. Deploy with rollback.
7. Remove the regex planner only after the tool runtime has production parity.

This avoids replacing a brittle system with an untested agent all at once.

## Target Architecture

### Current Shape

```text
User message
  -> handleInboundMessage
  -> pre-auth safety
  -> planCopilotAgent / planEmployeeIntent
  -> regex or JSON planner
  -> IntentPlan
  -> executePlan switch
  -> actions.ts
  -> audit and memory
```

This is router-first.

### Target Shape

```text
User message
  -> handleInboundMessage
  -> resolve actor and scoped transport
  -> pre-agent deterministic safety
  -> load memory and active record context
  -> runAyaToolAgent
       -> LLM sees system prompt, conversation context, tool registry
       -> LLM calls one or more tools
       -> each tool passes through policy wrapper
       -> actions.ts executes trusted work
       -> tool result is returned to LLM
       -> LLM either calls another tool or answers
  -> audit agent run, tool calls, visible response
  -> remember turn memory and active record
```

This is tool-first.

## Files To Add

### 1. `apps/copilot/src/modules/copilot/agent/tool-registry.ts`

Purpose:

- Define the tool map exposed to the LLM.
- Use Zod schemas for every tool input.
- Keep descriptions clear and operational.
- Keep tool names stable and readable.

Example tool naming:

- `searchClients`
- `getClientDetail`
- `getClientComments`
- `addClientComment`
- `moveClientToStage`
- `assignClient`
- `setClientDueDate`
- `completeClientRecord`
- `getMyAssignments`
- `getEmployeeAssignments`
- `getMyNotifications`
- `getTeamFollowUpQueue`
- `getTeamDaySummary`
- `getWorkspaceActivity`
- `getRecordActivity`
- `getExceptionReport`
- `getReportingOverview`
- `answerReportingQuestion`
- `getSignedInUser`

Important:

- These tools should wrap existing `actions.ts`.
- The LLM should not call the GraphQL client directly.
- The LLM should not know Blue workspace IDs.
- Tool descriptions should say when to use each tool and when not to use it.

### 2. `apps/copilot/src/modules/copilot/agent/runtime.ts`

Purpose:

- Own the Vercel AI SDK call.
- Build the system prompt.
- Add memory and active record context.
- Run the tool loop.
- Return a user-facing `MessageResponse`.

Likely implementation choice:

- Use Vercel AI SDK v6.
- Use `generateText` with `tools` first, because it is simple and testable.
- Consider `ToolLoopAgent` only if it materially simplifies multi-step orchestration after reading current docs.

Important:

- Before coding exact AI SDK APIs, check current docs. AI SDK v6 changed names and signatures from earlier versions.
- Use a model config instead of hardcoding a model.
- Keep max steps bounded, likely `5`.
- Keep tool result size bounded to protect token cost and response quality.

### 3. `apps/copilot/src/modules/copilot/agent/system-prompt.ts`

Purpose:

- Define the agent's mission and rules.
- Move language understanding out of regex and into the model.

Prompt should include:

- "You are Aya, an operations assistant for Aya Financial."
- "Your job is to help employees use Blue CRM accurately and safely."
- "Use tools when you need Blue data or need to perform an action."
- "Ask a short clarification question when the record, employee, or action is ambiguous."
- "Never claim an action succeeded unless a tool result says it succeeded."
- "Never invent Blue data."
- "Never mention internal tool names unless the user asks for technical detail."
- "Never perform bulk destructive actions."
- "For writes, if credentials are missing, explain that personal Blue write credentials are required."
- "Use the active record context for follow-ups like this client, this file, this record."
- "Keep responses concise and operational."

### 4. `apps/copilot/src/modules/copilot/agent/policy.ts`

Purpose:

- Enforce deterministic safety before and during tool calls.
- Do not trust the LLM for policy.

Responsibilities:

- Role permissions.
- Workspace allowlist.
- Forbidden workspace refusal.
- Bulk destructive refusal.
- Write credential checks.
- Tool-level allowed/denied checks.
- High-risk write classification.
- Response sanitation for policy errors.

This file should reuse or move logic from:

- `getPreAuthSafetyBlock`
- `enforceIntentPermissions`
- `resolveBlueWriteAuth`
- workspace ID config validation
- audit redaction helpers

### 5. `apps/copilot/src/modules/copilot/agent/audit.ts`

Purpose:

- Record every agent turn and every tool call consistently.
- Avoid putting large or sensitive raw objects into audit rows.

Audit shape:

```ts
{
  runtime: "ai-sdk-agent",
  model: "...",
  toolCalls: [
    {
      name: "getClientDetail",
      outcome: "success",
      arguments: { recordQuery: "AYA SMOKE TEST" },
      resultSummary: { recordId: "...", recordTitle: "AYA SMOKE TEST" }
    }
  ],
  visibleResponseText: "...",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalCost: null
  }
}
```

Do not audit:

- Blue token secret.
- Full provider auth headers.
- Raw OpenAI or Gateway request bodies if they include sensitive user data beyond what is needed for debugging.

### 6. `apps/copilot/src/modules/copilot/agent/tool-results.ts`

Purpose:

- Convert action results into compact LLM-safe tool outputs.
- Keep data enough for follow-up reasoning without dumping huge objects.

Examples:

- `getClientDetail` returns title, stage, status, owner names, latest comments, missing docs summary, next action.
- `searchClients` returns at most 5 candidates with title, list, record ID.
- `getExceptionReport` returns counts and first 12 items.
- `getWorkspaceActivity` returns counts and first 12 activity lines.

### 7. `apps/copilot/src/modules/copilot/agent/memory.ts`

Purpose:

- Prepare conversation context for the agent.
- Keep active record and recent turns available.

Input to the agent should include:

- Actor display name, email, role.
- Scoped transport/conversation key.
- Current active record, if any.
- Recent record list.
- Last user message and last response summary.
- Pending clarification/candidate state, if any.

Do not include:

- Full unbounded conversation history.
- Full raw Blue records.
- Secrets.

## Files To Modify

### `apps/copilot/package.json`

Add dependencies:

```json
{
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/openai": "^3.0.0"
  }
}
```

Exact versions should be checked at implementation time.

If using Vercel AI Gateway instead of direct OpenAI:

- `ai` alone may be enough for string model IDs routed through Gateway.
- Use `AI_GATEWAY_API_KEY` or Vercel OIDC depending on deployment.

Recommendation:

- Start with direct OpenAI through `@ai-sdk/openai` because the app already has `OPENAI_API_KEY`.
- Add Gateway later as an optional provider mode.

### `apps/copilot/src/config.ts`

Add config:

```text
AYA_CHAT_RUNTIME=agent|planner
AYA_AGENT_MODEL=openai/gpt-5.4 or provider-specific direct model
AYA_AGENT_MAX_STEPS=5
AYA_AGENT_TIMEOUT_MS=15000
AYA_AGENT_PROVIDER=openai|gateway
AI_GATEWAY_API_KEY optional
```

Keep existing config during migration:

```text
AYA_LLM_PLANNER_ENABLED
AYA_LLM_PLANNER_MODEL
AYA_LLM_PLANNER_TIMEOUT_MS
OPENAI_API_KEY
```

Later, deprecate planner config after the agent runtime is stable.

### `apps/copilot/src/modules/copilot/service.ts`

Current role:

- Resolve actor.
- Check safety.
- Plan.
- Execute plan.
- Audit.
- Remember memory.

Target role:

- Resolve actor.
- Check pre-agent safety.
- Choose runtime based on feature flag.
- Call `runAyaToolAgent` for `AYA_CHAT_RUNTIME=agent`.
- Keep current planner path for fallback.
- Return `MessageResponse`.

Feature flag behavior:

```text
AYA_CHAT_RUNTIME=planner
  -> existing path

AYA_CHAT_RUNTIME=agent
  -> new AI SDK tool-calling path

AYA_CHAT_RUNTIME=agent_with_planner_fallback
  -> try agent, fallback to planner only on model/provider errors
```

### `apps/copilot/src/modules/copilot/actions.ts`

Keep as the trusted action layer.

Add small changes where needed:

- Ensure every action accepts actor/transport/blueAuth context.
- Ensure write actions check safety before credential validation.
- Ensure comment writes route cleanly for "add a note" phrasing through the tool.
- Ensure action results are structured and compact.

Do not move LLM logic into `actions.ts`.

### `apps/copilot/src/modules/copilot/planner.ts`

Do not expand it further except for emergency QA fixes.

During migration:

- Keep it as a fallback.
- Stop adding new regex behavior unless it is blocking production.
- Add a deprecation comment at the top once the agent runtime is active.

After migration:

- Delete most or all of it.
- Keep only tiny deterministic helpers if genuinely needed, such as direct safety detection and context-pointer normalization.

### `apps/copilot/src/modules/copilot/llm-planner.ts`

Target:

- Replace with `agent/runtime.ts`.
- Remove JSON-plan prompts after agent runtime is stable.

Why:

- JSON planning is still a router pattern.
- Tool calling lets the model choose tools and observe results.

### `apps/copilot/deploy/hostinger/env/aya.env.example`

Add the new runtime config:

```text
AYA_CHAT_RUNTIME=agent
AYA_AGENT_PROVIDER=openai
AYA_AGENT_MODEL=gpt-5.4
AYA_AGENT_MAX_STEPS=5
AYA_AGENT_TIMEOUT_MS=15000
```

If AI Gateway is used:

```text
AYA_AGENT_PROVIDER=gateway
AYA_AGENT_MODEL=openai/gpt-5.4
AI_GATEWAY_API_KEY=replace-with-vercel-ai-gateway-key
```

Keep `OPENAI_API_KEY` if direct OpenAI is used.

## Tool Registry Design

### Tool: `getSignedInUser`

Purpose:

- Answer "who am I signed in as?"
- Return actor name, email, role.

Schema:

```ts
z.object({})
```

Policy:

- Always allowed after actor resolution.

### Tool: `searchClients`

Purpose:

- Find candidate Blue records by name, email, phone, or title fragment.

Schema:

```ts
z.object({
  query: z.string().describe("Client name, file title, email, or phone"),
  limit: z.number().int().min(1).max(10).optional()
})
```

Tool result:

- Candidates only, not full raw record.
- If multiple candidates, return them so the model can ask the user which one.

### Tool: `getClientDetail`

Purpose:

- Read a client/file and produce a status summary, briefing, blockers, missing docs, or call prep.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  detailMode: z.enum(["default", "briefing", "call_prep"]).optional(),
  briefingFocus: z.enum(["general", "handoff", "blockers", "missing_docs"]).optional()
})
```

Rules:

- If user says "this client" and active record exists, use active context.
- If both `recordId` and `recordQuery` are missing, tool should reject with a structured clarification requirement.

### Tool: `getClientComments`

Purpose:

- Show recent comments for a record.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional()
})
```

### Tool: `addClientComment`

Purpose:

- Add a comment/note to a specific Blue record.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  text: z.string().min(1).max(2000)
})
```

Policy:

- Requires write permission.
- Requires actor Blue write credentials unless system fallback is explicitly enabled.
- Must refuse bulk targets.
- Must only use allowed workspace ID.

This directly fixes the remaining local QA failure:

```text
add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14
```

Expected missing-credential response:

```text
Your Blue account is not connected for write actions yet. Open the Aya MCP server settings, save your personal Blue Token ID and Secret, then try again.
```

### Tool: `moveClientToStage`

Purpose:

- Move one specific client/file to one specific stage/list.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  targetListQuery: z.string()
})
```

Policy:

- Requires write permission.
- Refuse all/every/each/whole-workspace destructive updates.
- Requires exact record match for writes.

### Tool: `assignClient`

Purpose:

- Assign a specific record to a specific employee.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  assigneeName: z.string()
})
```

### Tool: `setClientDueDate`

Purpose:

- Set due date on one record.

Schema:

```ts
z.object({
  recordId: z.string().optional(),
  recordQuery: z.string().optional(),
  useActiveRecordContext: z.boolean().optional(),
  dueDate: z.string().describe("ISO date or natural date phrase")
})
```

Policy:

- Date normalization happens in code.
- Model may understand "tomorrow," but code must convert and validate.

### Tool: `completeClientRecord`

Purpose:

- Mark one specific record complete/done.

Policy:

- High risk.
- Must reject bulk targets.
- Must require exact match.

### Tool: `getEmployeeAssignments`

Purpose:

- Show open/completed/all assignments for the signed-in employee or a named employee.

Schema:

```ts
z.object({
  employeeName: z.string().optional(),
  status: z.enum(["open", "completed", "all"]).optional()
})
```

Policy:

- Employee can only see own assignments.
- Admin can see others.

### Tool: `getEmployeeNotifications`

Purpose:

- Show notifications for signed-in employee or named employee.

Policy:

- Employee can only see own notifications.
- Admin can see others if allowed by product policy.

### Tool: `getTeamFollowUpQueue`

Purpose:

- Answer team overdue/follow-up questions for admins.

Policy:

- Admin only.

### Tool: `getTeamDaySummary`

Purpose:

- Summarize team activity.

Policy:

- Admin only.

### Tool: `getWorkspaceActivity`

Purpose:

- Answer "who commented today?", "who moved clients today?", "what changed today?", etc.

Schema:

```ts
z.object({
  focus: z.enum(["all", "comments", "moves", "creates", "timeline"]).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  dateLabel: z.string().optional()
})
```

Policy:

- Admin only.

### Tool: `getExceptionReport`

Purpose:

- Report missing structured fields and unassigned records.

Schema:

```ts
z.object({
  focus: z.enum([
    "all",
    "assignment",
    "assignee",
    "client_name",
    "email",
    "phone",
    "finance_amount",
    "due_date",
    "closing_date"
  ]).optional(),
  employeeName: z.string().optional(),
  contactFallbackMode: z.enum(["structured_only", "visible_text_fallback"]).optional()
})
```

Policy:

- Admin only.

Important remaining QA fix:

- For `which records are missing phone?`, if a phone is visible in title/text but missing from the structured Phone field, the response must not simply say "missing phone" without explanation.
- Use one of two acceptable approaches:
  - Treat phone/email in title/text as fallback contact info and do not include those records in missing phone/email reports.
  - Or explicitly say "missing structured Phone field" and include a note that visible phone-like text may exist in the title.

Recommendation:

- Use visible text fallback by default for user-facing missing-phone/email reports.
- Keep structured-only report available internally if needed.

## Remaining QA Fixes Before Agent Migration

These should be done before or at the start of the agent migration.

### Fix 1: Missing Phone Fallback

Problem:

- Records with visible phone numbers in title/details appear in "missing phone" reports.
- This looks wrong to users even if the structured custom field is empty.

Implementation:

- Add fallback extractors:

```ts
extractVisiblePhone(recordTitle, rawRecord.text, customFieldText)
extractVisibleEmail(recordTitle, rawRecord.text, customFieldText)
```

- For user-facing `phone` focus:
  - Consider structured Phone field present if custom field has value.
  - Otherwise consider phone present if visible phone pattern exists in title/text.

Phone fallback should detect:

- `905-869-3458`
- `(226) 978-2392`
- `(647) 686-2864`
- `905 599 9990`
- `(519) 580-1212`
- `+1 416 555 0100`

Avoid overly broad matching:

- Require at least 10 digits after stripping punctuation.
- Accept 11 digits only if leading digit is `1`.

### Fix 2: Missing Email Fallback

Problem:

- Records with visible emails appear in "missing email" reports.

Implementation:

- Add email regex fallback only for recognizable email strings:

```text
name@example.com
```

- Treat fallback email as contact info for user-facing missing-email report.

Examples from retest:

- `alazemha@gmail.co`
- `khalilPhysio@gmail.com`
- `kynvalley@gmail.com`

### Fix 3: Comment Write Tooling

Problem:

This prompt did not route:

```text
add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14
```

Short-term implementation:

- Before full agent migration, add deterministic support or tool-call support for note/comment write.
- Because the user does not want more regex long term, prefer making this pass through the new agent tool registry if the migration starts immediately.

Acceptance:

- With no write credentials:

```text
Your Blue account is not connected for write actions yet. Open the Aya MCP server settings, save your personal Blue Token ID and Secret, then try again.
```

- With write credentials:
  - Adds one comment to `AYA SMOKE TEST`.
  - Audits the write.
  - Does not touch any other record.

## Agent Runtime Detailed Flow

### Step 1: Resolve Actor

Input:

- `actorEmployeeId`
- `actorEmployeeEmail`
- `actorEmployeeName`
- `senderId`
- `transport`
- `conversationKey`

Output:

- `EmployeeIdentity`
- scoped transport
- request-scoped Blue write auth

This stays deterministic.

### Step 2: Pre-Agent Safety

Run before model call:

- Empty message check.
- Bulk destructive refusal.
- Unmapped employee handling.
- Token/header redaction.

Reason:

- We should not spend model tokens on requests that must be refused.
- We should not let the model decide whether "delete all records" is safe.

### Step 3: Build Agent Context

Context should include:

```json
{
  "actor": {
    "displayName": "Hamza Paracha",
    "email": "hamza@ayafinancial.com",
    "roleName": "admin"
  },
  "conversation": {
    "transport": "librechat:<conversation-id>",
    "activeRecord": {
      "recordId": "...",
      "recordTitle": "AYA SMOKE TEST",
      "listTitle": "..."
    },
    "recentRecords": []
  },
  "today": "2026-05-14"
}
```

Do not include secrets.

### Step 4: Run Tool Loop

Model call:

- Model sees system prompt.
- Model sees user message.
- Model sees context.
- Model sees tool registry.

Bounded execution:

- `maxSteps = 5`
- timeout around full agent request
- per-tool timeout where needed
- max tool result size

### Step 5: Tool Policy Wrapper

Every tool execute function should be wrapped:

```ts
withAyaToolPolicy({
  toolName,
  actor,
  transport,
  blueAuth,
  riskLevel,
  requiredRole,
  writeRequired,
  execute
})
```

The wrapper handles:

- Permission check.
- Bulk destructive check.
- Blue credential check.
- Workspace ID guard.
- Audit event.
- Error normalization.

### Step 6: Model Final Response

The model should answer only after observing tool results.

Rules:

- Do not claim success without a successful write tool result.
- If a write tool returns missing credentials, explain credential setup.
- If search returns multiple candidates, ask a clarifying question.
- If no data exists, say so clearly.
- Do not expose internal traces, JSON, schemas, or tool names by default.

### Step 7: Persist Memory

After response:

- Remember active record if a tool result identifies one.
- Remember recent records.
- Remember last user message and response summary.
- Remember pending clarification candidates if the model asks a question.

## Error Handling Model

### Tool Error Types

Use structured errors:

```ts
type AyaToolError =
  | { code: "PERMISSION_DENIED"; message: string }
  | { code: "WRITE_AUTH_REQUIRED"; message: string }
  | { code: "BULK_DESTRUCTIVE_REFUSED"; message: string }
  | { code: "RECORD_NOT_FOUND"; message: string; candidates?: Candidate[] }
  | { code: "AMBIGUOUS_RECORD"; message: string; candidates: Candidate[] }
  | { code: "BLUE_REJECTED"; message: string }
  | { code: "TOOL_TIMEOUT"; message: string }
```

Do not let raw exceptions leak to the user.

### Clarification

If a tool returns `AMBIGUOUS_RECORD`, the LLM should ask:

```text
I found two matches. Which one do you mean?
1. John Smith (Leads)
2. John Smith (Underwriting)
```

The pending candidates should be saved so the next answer can resolve the selection.

## Security Model

### Workspace Safety

Allowed workspace:

```text
cmn524yr800e101mh7kn44mhf
```

Forbidden workspace:

```text
cmhazc4rl1vkand1eonnmiyjy
```

Rules:

- No tool should accept workspace ID from the LLM.
- Workspace ID must come from config.
- Config validation should reject startup if write workspace is missing or forbidden.
- Blue MCP writes must never be all-workspaces or unspecified workspace writes.

### Write Safety

Writes include:

- add comment
- move record
- assign record
- complete record
- set due date
- create lead
- edit task/checklist

Write requirements:

- actor resolved
- workspace allowed
- exact record match unless creating
- personal Blue credentials present unless explicit fallback enabled
- audit row recorded

### Bulk Destructive Refusal

Refuse:

- `delete all records`
- `move every record to Done`
- `assign all files to Hamza`
- `mark all clients complete`
- `close all records`

This refusal must happen before model call and again inside write tool policy.

## Model and Provider Strategy

### Phase 1: Direct OpenAI Provider

Use:

- `ai`
- `@ai-sdk/openai`
- existing `OPENAI_API_KEY`

Reason:

- Lowest deployment change.
- Current production already has OpenAI config.
- Easier rollback.

### Phase 2: Optional Vercel AI Gateway

Use if needed:

- `AI_GATEWAY_API_KEY`
- plain model strings such as `openai/gpt-5.4`

Benefits:

- Unified provider routing.
- Cost visibility.
- Optional failover.
- No markup when using listed provider prices per current Vercel docs.

Tradeoff:

- Adds another account/config surface.
- Free credits do not mean production usage is free.

## Testing Strategy

### Unit Tests

Add tests for:

- Tool schema validation.
- Tool policy permission checks.
- Write credential required behavior.
- Bulk destructive refusal inside tools.
- Workspace ID guard.
- Tool result compaction.
- Phone/email fallback extractors.

### Agent Runtime Tests

Use mocked AI SDK calls.

Test cases:

- Model calls `getSignedInUser` for "who am I signed in as?"
- Model calls `getEmployeeAssignments` for "show my assignments."
- Model calls `getTeamFollowUpQueue` for "who has overdue assignments?"
- Model calls `getClientComments` then `getClientDetail` for multi-step AYA prompt.
- Model calls `addClientComment`; missing credentials returns credential message.
- Model receives ambiguous search results and asks clarification.
- Model cannot bypass permission wrapper for named employee notifications.

### Local End-to-End Tests

Use `/messages` route with local DB:

- Admin:
  - `who has overdue assignments?`
  - `summarize the team today`
  - `find AYA SMOKE TEST, summarize recent comments, then tell me the next follow-up`
  - `search for AYA SMOKE TEST and prep me for a call`
  - `show me comments on the smoke test file`
  - `who commented today?`
  - `which records have no assignee?`
  - `which records are missing phone?`
  - `which records are missing email?`
  - `move every record to Done`
  - `add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14`

- Employee:
  - `show my assignments`
  - `show Rehan's notifications`
  - `show me AYA SMOKE TEST`
  - `comments on this client`

### Production Smoke Tests

Keep:

- `node scripts/verify_production.mjs`

Add a chat behavior smoke script:

- `scripts/verify_production_chatbot.mjs`

It should test only safe reads and safe refusals unless a dedicated QA write account is configured.

Safe production checks:

- health/config/login/MCP protected
- mapped admin identity
- mapped employee identity
- unmapped account guidance
- team summary for admin
- permission refusal for employee reading another employee
- bulk destructive refusal
- missing phone/email wording

Optional write check:

- Only if `PRODUCTION_QA_BLUE_TOKEN_ID` and `PRODUCTION_QA_BLUE_TOKEN_SECRET` are present.
- Only against `AYA SMOKE TEST`.
- Add a clearly marked QA comment.
- Verify audit row.

## Evaluation Dataset

Create:

- `apps/copilot/tests/fixtures/chatbot-evals/qa-prompts.json`

Each case:

```json
{
  "id": "admin-team-overdue",
  "actor": "admin",
  "message": "who has overdue assignments?",
  "expected": {
    "mustContain": ["Team follow-up queue"],
    "mustNotContain": ["Which employee"]
  },
  "write": false
}
```

Use this dataset for:

- planner fallback tests while still present
- agent runtime tests
- local smoke script
- production smoke script safe subset

## Migration Phases

### Phase 0: Finish Current Local QA

Goal:

- Make `docs/internal/local-chatbot-retest-2026-05-14.md` fully pass before the larger agent refactor.

Tasks:

1. Add visible phone fallback for exception reports.
2. Add visible email fallback for exception reports.
3. Add note/comment write handling.
4. Add tests for all three.
5. Run:
   - `npm test` in `apps/copilot`
   - `npm run check` in `apps/copilot`
   - `npm run build` in `apps/copilot`

Deliverable:

- Local retest report updated or superseded with all items passing.

### Phase 1: Add AI SDK Dependencies and Config

Tasks:

1. Install `ai` and direct provider package.
2. Add config options.
3. Add env example docs.
4. Add a no-op agent runtime that returns fallback response when disabled.
5. Verify build and tests.

No production behavior change yet.

### Phase 2: Build Tool Registry

Tasks:

1. Create tool schemas.
2. Wrap read actions first.
3. Add tool result compaction.
4. Add policy wrapper for read permissions.
5. Add tests for tool execution without model calls.

Read tools first:

- identity
- search
- detail
- comments
- assignments
- notifications
- team summary
- team follow-up
- activity
- exception reports

### Phase 3: Build Agent Runtime for Read-Only Flows

Tasks:

1. Build system prompt.
2. Call Vercel AI SDK with read tools.
3. Add model call mocks.
4. Route `/messages` through agent behind `AYA_CHAT_RUNTIME=agent`.
5. Validate read-only QA prompts.

Do not enable write tools yet.

### Phase 4: Add Write Tools with Policy

Tasks:

1. Add `addClientComment`.
2. Add `moveClientToStage`.
3. Add assign/due/complete tools.
4. Enforce exact match for writes.
5. Enforce write credentials.
6. Add missing credential tests.
7. Add dedicated QA write tests with mocked Blue client.

### Phase 5: Disambiguation and Memory

Tasks:

1. Return candidates from search/detail failures.
2. Teach prompt to ask clarification.
3. Save pending candidates.
4. Resolve next message against saved candidates.
5. Update active record memory after read/write tools.
6. Validate parallel conversation isolation.

### Phase 6: Audit and Reporting

Tasks:

1. Record agent runtime rows.
2. Record per-tool compact summaries.
3. Update admin activity reports to read new audit shape.
4. Validate:
   - `who commented today?`
   - `who moved clients today?`
   - `who touched AYA SMOKE TEST today?`

### Phase 7: Local Full QA

Tasks:

1. Run automated tests.
2. Run local `/messages` QA.
3. Run LibreChat UI if Docker is available.
4. Verify no secrets in logs.
5. Verify audit rows.
6. Verify Blue QA record not accidentally modified except deliberate QA write test.

### Phase 8: Staged Production Deploy

Tasks:

1. Commit code.
2. Push branch/main as requested.
3. Snapshot Hostinger VPS or back up data.
4. Pull updated repo on server.
5. Review env changes.
6. Deploy:

```bash
cd apps/copilot/deploy/hostinger
docker compose up -d --build
```

7. Run:

```bash
node scripts/verify_production.mjs
```

8. Run safe chatbot QA.
9. Run optional QA write only if credentials are explicitly provided.

### Phase 9: Cleanup Old Planner

Only after production parity:

1. Remove old JSON LLM planner.
2. Delete most regex resolvers.
3. Keep minimal deterministic safety helpers.
4. Keep eval dataset as regression suite.
5. Update docs to describe agent/tool architecture.

## Acceptance Criteria

The migration is successful only when:

- Local retest report is full pass.
- Production retest is full pass for safe prompts.
- Comment write prompt routes correctly.
- Missing phone/email reports no longer look false-positive to users.
- The agent can complete multi-step read workflows without custom regex for each phrasing.
- Employee permission boundaries hold.
- Bulk destructive safety holds through both message entrypoint and direct tool execution.
- Every tool call is audited.
- No secrets are exposed in responses or audit logs.
- The old planner is no longer the primary decision layer.

## Risks and Mitigations

### Risk: LLM Calls Wrong Tool

Mitigation:

- Strong tool descriptions.
- Zod schemas.
- Policy wrapper.
- Tests with mocked model tool calls.
- No direct GraphQL access from model.

### Risk: LLM Hallucinates Success

Mitigation:

- System prompt says never claim success without tool result.
- Write tools return explicit success/failure.
- Final response must derive from tool results.
- Tests assert missing credentials are reported.

### Risk: Token Cost Increases

Mitigation:

- Compact tool results.
- Keep max steps low.
- Use cheaper model for routine operations if quality is acceptable.
- Add usage logging.
- Consider AI Gateway reporting later.

### Risk: Production Regression

Mitigation:

- Feature flag runtime.
- Planner fallback during rollout.
- Hostinger snapshot before deploy.
- Safe production smoke scripts.
- Rollback via previous git commit and compose rebuild.

### Risk: Regex Creeps Back In

Mitigation:

- Freeze `planner.ts` except emergency fixes.
- Put new language handling in tool descriptions and system prompt.
- Use eval tests instead of adding new regex branches.
- Delete planner after parity.

## Rollback Plan

If agent runtime fails in production:

1. Set:

```text
AYA_CHAT_RUNTIME=planner
```

2. Restart Aya container.
3. If needed, roll back repo to previous commit.
4. Rebuild compose stack.
5. Run production verification.

This is why the first deployment should keep the planner path available.

## Definition of "Not Regex Bot"

Acceptable deterministic code:

- Security checks.
- Permission checks.
- Workspace ID validation.
- Credential validation.
- Date normalization after the model proposes a date.
- Phone/email extraction for reports.
- Tool schema validation.
- Audit redaction.

Not acceptable as the long-term decision layer:

- More giant intent regex.
- More phrase-by-phrase routing.
- More hardcoded "show me / tell me / pull up" trees.
- More JSON-plan classification prompts that just recreate routing.

The LLM should decide which tool to call. TypeScript should decide whether that call is allowed.

## Immediate Next Implementation Checklist

1. Fix visible phone/email fallback in exception reports.
2. Fix `add a note to AYA SMOKE TEST saying ...` comment write handling.
3. Add regression tests for both.
4. Run Copilot tests/check/build.
5. Create AI SDK dependency/config branch work.
6. Add tool registry and read-only tools.
7. Add agent runtime behind feature flag.
8. Validate read-only QA.
9. Add write tools.
10. Validate write credential behavior.
11. Run local retest.
12. Push.
13. Deploy.
14. Run production verification and chatbot QA.

## Final Recommendation

Move to Vercel AI SDK tool calling, but do it as a controlled migration.

The best version of Aya is not a regex router and not an unconstrained LLM. It is:

- LLM for language understanding and multi-step tool use.
- TypeScript for safety, permissions, workspace boundaries, credentials, and audit.
- Existing `actions.ts` as the durable business capability layer.

That gives the product the natural feel of an actual assistant without letting the model make unsafe Blue decisions.
