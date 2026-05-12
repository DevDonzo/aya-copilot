# Aya Copilot Architecture Plan

## Purpose

Build an internal Aya Financial operations assistant that sits on top of Blue and other work systems.

The product should do three things well:

1. help employees complete routine work without living in the Blue dashboard
2. help managers understand what people are doing each day
3. add one place to search, summarize, and act across multiple systems

This document is the end-state architecture plan, not a handoff and not just a note about the current repo state.

## Current Safe Scope

Until the product loop is stable, all Blue reads and writes stay in the pilot workspace only:

- workspace name: `03 - AYA x Hamza/ AI`
- workspace ID: `cmn524yr800e101mh7kn44mhf`

The real workspace should not be touched until the bot is accurate, safe, and operationally useful in `03 - AYA x Hamza/ AI`.

## Product Definition

The assistant is not a second CRM.

Blue remains the system of record for:

- records
- lists/columns
- comments
- assignments
- tags
- activity
- record details

The Aya bot adds:

- employee identity mapping
- natural-language routing
- safe action execution
- chat-friendly summaries
- manager rollups
- cross-system activity collection
- search and drill-down across systems

## Recommended User Experience

### Primary interface

Use LibreChat as the primary employee-facing chat UI.

Reason:

- everyone already works on laptops
- LibreChat already provides a chat-first interface and login flow
- employees only need one clean internal URL
- Aya can stay focused on business logic instead of rebuilding chat UX
- employee chat and admin tooling can stay separated cleanly

LibreChat should provide:

- employee login
- a simple chat interface
- Aya MCP tools behind the scenes
- no exposed Blue credentials or Blue UI details

Aya should provide:

- employee identity resolution
- role-based permissions
- audit logs
- Blue-safe action execution
- team summaries
- manager/admin chat reporting

### Secondary interface

Keep manager/admin reporting inside the chatbot and MCP layer instead of a separate dashboard.

Use it for:

- employee audit trails
- raw chat transcript review
- action logs
- team activity rollups
- operational troubleshooting

Manager-only reporting tools should remain role-gated inside the chatbot.

### Optional interfaces

Add more transports only if they create real operational value:

- Slack if Aya already uses it internally
- Microsoft Teams if that is the existing company communication hub

## Channel Decision

### Best overall recommendation

Build this in phases:

1. LibreChat as the private employee chat UI
2. manager/admin chat reporting through role-gated chatbot tools
3. optional Slack or Teams transports later

### Why LibreChat first

- it matches the chatbot product shape the company actually wants
- it already solves chat UX and login better than a custom Aya UI
- it keeps Aya focused on permissions, logging, and system orchestration
- it is easier to host one internal chat product than multiple partial front ends

## System Architecture

### 1. Client layer

Possible clients:

- LibreChat
- role-gated manager/admin chatbot reporting
- optional Slack app
- optional Teams bot

All clients talk to the same backend. The backend owns the logic.

### 2. API and orchestration layer

This is the Aya bot backend.

Responsibilities:

- authenticate the user or transport sender
- map sender or session to an employee
- classify the request into a supported intent
- resolve names to exact Blue or internal IDs
- execute one approved backend action
- store audit logs
- return a concise response

This layer should never let the model invent raw shell commands or arbitrary queries.

### 3. Intent and policy layer

Every supported request maps to a fixed intent definition.

Examples:

- `records.list_assigned`
- `records.search`
- `records.move`
- `comments.create`
- `summary.employee_day`
- `summary.team_day`
- `summary.no_activity_day`

Each intent definition should include:

- required fields
- resolver rules
- adapter target
- permission rules
- confirmation rules

### 4. Blue adapter layer

There should be one Blue adapter boundary for runtime execution.

Recommended implementation path:

1. keep the existing CLI-backed adapter first because it already works
2. keep it behind a small interface so it can be swapped later if needed
3. only replace it with a direct Blue API client if CLI gaps or performance become a real issue

The bot should not mix multiple Blue execution paths for the same runtime intent.

### 5. Event ingestion layer

Collect structured events from:

- Blue activity
- bot requests and responses
- later: email, calendar, phone systems

Normalize all events into one internal format and store them locally.

### 6. Storage layer

Current local database is SQLite. That is fine for development.

Production target should likely be Postgres.

Core tables:

- `employees`
- `identity_links`
- `blue_lists_cache`
- `blue_records_cache`
- `activity_events`
- `bot_audit_logs`
- `daily_summaries`

### 7. Summary and reporting layer

This layer answers:

- what did Sarah do today?
- what did everyone do today?
- who has no activity today?
- what is Sarah working on?
- what changed in underwriting?

This layer should answer from the local event store and cache where possible, not by re-querying everything live on each question.

## Core Data Flows

### Employee action flow

1. user sends a message or submits text in the web app
2. backend resolves user identity
3. backend classifies the request
4. backend resolves record/list/employee names
5. backend executes one Blue action
6. backend writes bot audit log
7. backend returns result

### Manager summary flow

1. manager asks a summary question
2. backend resolves target employee or team scope
3. backend reads normalized activity events
4. backend summarizes into a short response
5. backend optionally links to structured detail in the web app

### Client lookup flow

1. user searches by client name, email, or phone
2. backend resolves matching Blue records
3. backend returns:
   - current list/column
   - assignee
   - due date
   - recent comments
   - key record fields
4. user can optionally take an action from that view

## Security and Control Model

### Identity

Use company-backed auth for LibreChat and manager/admin chatbot tools:

- Google Workspace SSO or Microsoft Entra ID if available

Use `identity_links` for system mapping:

- Blue user ID
- employee email
- optional future transport IDs

### Permissions

Roles should be simple:

- employee
- manager
- admin

Examples:

- employee can view own work and act on allowed records
- manager can view team summaries and search across employees
- admin can manage mappings, settings, and audit logs

### Safety rules

- all Blue writes must stay scoped to the allowed workspace in test mode
- ambiguous writes must ask for confirmation
- sensitive actions should require explicit confirmation even when resolved
- every request and action must be logged

## Phased Delivery Plan

### Phase 1: pilot workspace core

Goal:

prove that the assistant can safely read and write in `03 - AYA x Hamza/ AI`

Deliver:

- identity mapping
- Blue activity polling
- local workspace index
- move/comment/search actions
- employee and team summaries

### Phase 2: LibreChat employee UI

Goal:

make the assistant usable as a real internal tool

Deliver:

- authenticated LibreChat deployment
- Aya MCP integration
- employee chat workflow
- company email identity bridge
- clean employee-safe tool exposure

### Phase 3: manager reporting and client drill-down

Goal:

make the assistant operationally useful beyond quick chat commands

Deliver:

- role-gated manager/admin chatbot reporting
- employee audit/history page
- manager timeline views
- client search by name/email/phone
- current status/list display
- recent comments
- key record details
- direct record actions from the UI

### Phase 4: optional transport expansion

Goal:

add convenience access without changing the core architecture

Deliver:

- optional sender mapping
- short mobile-friendly replies
- safe-action confirmation patterns
- notification routing

### Phase 5: cross-system activity

Goal:

answer "what did this person do today?" beyond Blue only

Deliver:

- email metadata ingestion
- calendar events
- phone/call logs
- unified employee timeline

### Phase 6: production workspace rollout

Goal:

move the same proven system from `03 - AYA x Hamza/ AI` to real CRM safely

Deliver:

- workspace switch controls
- production credentials
- production audit checks
- rollback plan

## What Still Needs To Be Built

The biggest missing pieces today are:

- production LibreChat deployment and auth hardening
- richer client/record detail retrieval beyond the current cache
- unified employee timeline across Aya logs and LibreChat transcripts
- richer manager queries by list/stage/date
- non-Blue connectors
- optional secondary transports

## Recommendation

If the question is "what should employees actually use?", the best answer is:

- use LibreChat as the private employee-facing chat product
- keep Aya as the backend and admin surface
- keep Blue as the CRM system of record
- add other transports later only where they create real value

That gives Aya the chatbot experience it wants without rebuilding chat UX or exposing operations tooling publicly.

## Private Cloud Deployment Model

Everything should be containerized and deployed privately in the cloud.

Recommended shape:

- one LibreChat container or compose stack for employee chat
- one Aya backend container
- role-gated manager/admin reporting served through Aya MCP tools
- one database for LibreChat
- one database for Aya
- private internal networking between LibreChat and Aya

Network model:

- LibreChat is reachable only by employees
- Aya backend is not directly public
- manager/admin reporting is available through role-gated chatbot tools
- Blue credentials live only in Aya, never in LibreChat or the browser

Suggested hostnames:

- employee chat: `chat-internal.ayafinancial.com`
- manager reporting: role-gated prompts inside LibreChat
- Aya backend: internal-only, no public hostname required

Cost-effective first production setup:

- one small cloud VM
- Docker Compose for LibreChat, Aya, Mongo, and Postgres
- reverse proxy with HTTPS
- private firewall rules

Scale-up path later:

- move databases to managed services
- separate LibreChat and Aya onto different instances
- add SSO and tighter network policies

## References

- Slack platform overview: https://docs.slack.dev/
- Microsoft Teams bot overview: https://learn.microsoft.com/en-us/microsoftteams/platform/resources/bot-v3/bots-overview
