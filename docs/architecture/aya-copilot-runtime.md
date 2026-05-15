# Aya Copilot Runtime

## What Aya Is Now

Aya is now explicitly the durable product boundary, with LibreChat treated as the current employee shell rather than the core business layer.

Current runtime:

`LibreChat -> Aya MCP or HTTP -> Aya copilot service -> Aya action services -> Blue GraphQL`

Future runtime:

`Aya employee web app -> Aya HTTP -> Aya copilot service -> Aya action services -> Blue GraphQL`

## What Changed In This Refactor

The main refactor moves the product logic out of the old message handler and out of the MCP helper layer into a shared Aya application layer:

- `apps/copilot/src/modules/copilot/planner.ts`
  - typed planner output with `intent`, `confidence`, extracted `parameters`, matched signals, and clarification state
- `apps/copilot/src/modules/copilot/actions.ts`
  - reusable Aya action services for search, detail, comments, workload, move, create, summaries, and reporting
- `apps/copilot/src/modules/copilot/service.ts`
  - shared execution flow: `plan -> enforce -> execute -> audit`

The previous `apps/copilot/src/messages/handle-message.ts` path is now a thin re-export into the shared copilot service.

The previous `apps/copilot/src/mcp/service.ts` layer is now a thin compatibility wrapper over the same shared Aya action services.

## Why This Matters

Before this refactor:

- message understanding, policy, Blue execution, formatting, and audit handling were fused together
- the regex router was effectively the product brain
- MCP helper code duplicated the same record resolution and Blue operation logic
- natural follow-up requests such as `comments on this client` and `move this to underwriting` were brittle

After this refactor:

- Aya has one shared execution core
- MCP is only a transport adapter
- HTTP and MCP can call the same typed logic
- planner output is explicit and inspectable
- deterministic guardrails still run after planning, before any write

## Request Lifecycle

1. Resolve the employee actor and transport context.
2. Build a typed plan with intent, confidence, parameters, and clarification state.
3. Enforce deterministic permissions and write safety.
4. Execute the selected Aya action service.
5. Audit the plan and execution result.

This makes the next frontend step straightforward:

- a dedicated Aya employee UI can call `/messages/plan` to preview intent and clarification
- the same UI can call `/messages` to execute the exact same backend flow

## UX Improvements In Scope

The planner now directly supports stronger handling for:

- `show me Jordan`
- `what's going on with X`
- `comments on this client`
- `move this to underwriting`
- shorthand lead amounts like `275k`

Aya also now keeps an active record context per employee session path, so follow-up actions can reuse the currently opened client without making the employee restate the file name.

## Safety Model

- Blue remains the system of record.
- Aya is the enforcement layer.
- Employee-triggered writes still use employee Blue credentials when provided.
- Audit logging is preserved, with planner data now captured alongside execution output.
- Workspace safety remains constrained to the allowed Blue workspace:
  - `cmhazc4rl1vkand1eonnmiyjy`

## Rollout Guidance

Recommended rollout order:

1. Keep LibreChat as the shell.
2. Route employee chat through `aya_message`.
3. Validate planner accuracy with real employee utterance coverage.
4. Expose `/messages/plan` and `/messages` to any Aya-native frontend.
5. Incrementally move employee UX from LibreChat into Aya-native surfaces without changing the business layer again.

## Next Phase

The next high-value steps are:

- add a bounded model-assisted planner behind the same typed contract as an optional fallback
- introduce richer client context summaries for call prep and manager rollups
- add an Aya-native employee UI that consumes `/messages/plan` and `/messages`
- extend chatbot-based manager reporting to surface planner confidence, clarification rate, and intent mix
