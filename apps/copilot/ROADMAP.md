# Aya Copilot Roadmap

## Goal

Build a WhatsApp-first employee and manager assistant for Aya Financial that uses Blue as the system of record, starting in the safe pilot workspace:

- workspace name: `03 - AYA x Hamza/ AI`
- workspace ID: `cmn524yr800e101mh7kn44mhf`

The bot should help employees work without opening the Blue dashboard and help managers understand who is doing what each day.

## Non-Goal

Do not rebuild Blue features that already exist well enough in Blue.

That means:

- do not recreate Blue’s record model
- do not create a second CRM
- do not create a second activity feed
- do not replace Blue list moves, comments, assignments, or record updates with custom business logic

## Blue vs Bot Boundary

### Blue-owned capabilities we should reuse

- records, lists, comments, assignments, tags, and moves
- activity data
- user and workspace data
- record details and comments

### Bot-owned capabilities we should add

- WhatsApp transport
- phone-number to employee mapping
- natural-language intent routing
- record/list/employee name resolution
- manager summaries and daily rollups
- cross-system activity logging beyond Blue
- approvals and guardrails for ambiguous or sensitive actions

## Checklist

### Foundation

- [x] Restrict work to `03 - AYA x Hamza/ AI`
- [x] Verify Blue auth for the current operator
- [x] Add Blue activity access in the CLI
- [x] Create the `aya-copilot` repo
- [x] Add SQLite persistence
- [x] Add Blue activity ingestion and polling
- [x] Sync employees from `03 - AYA x Hamza/ AI`

### Current Bot Core

- [x] Add transport-ready `/messages` ingress
- [x] Add sender-to-employee identity linking
- [x] Add local Blue workspace index sync
- [x] Resolve natural-language list names like `0.2`
- [x] Resolve natural-language record names like `Sheraz`
- [x] Execute fixed Blue actions from resolved intents
- [x] Add per-employee daily summaries
- [x] Add team daily summaries
- [x] Add inactive-employee reporting
- [x] Add manager workload lookups by employee name

### Next Up

- [ ] Add a real WhatsApp webhook adapter
- [ ] Add reply formatting that is short and phone-friendly
- [ ] Add explicit confirmation flow for ambiguous writes
- [ ] Add rate limits and request authentication around public endpoints
- [ ] Add a bot audit endpoint for admin review

### Manager Features

- [ ] `What changed in underwriting today?`
- [ ] `Who touched client X today?`
- [ ] `Show me all files assigned to Sarah in 0.2`
- [ ] `Which employees have overdue work?`
- [ ] `Who moved the most files today?`

### Client Lookup

- [ ] Search clients by name, email, or phone
- [ ] Show current Blue column/list
- [ ] Show record comments
- [ ] Show assigned owner and due date
- [ ] Show key customer info pulled from Blue record details

### Cross-System Logging

- [ ] Add WhatsApp message logging
- [ ] Add email metadata connector
- [ ] Add calendar connector
- [ ] Add phone/call log connector
- [ ] Merge all activity into one employee timeline

## Implementation Order

1. Keep improving the copy-workspace bot until the daily loop feels solid.
2. Add the real WhatsApp adapter.
3. Add better manager queries.
4. Add client lookup and record-detail views.
5. Add non-Blue sources one by one.
6. Only then point the same system at the real CRM.

## Rules

- Every Blue write must stay scoped to `cmn524yr800e101mh7kn44mhf`.
- The bot should execute one Blue adapter action per request.
- The bot should prefer fixed command templates over free-form command generation.
- Every inbound message and outbound action should be logged.
