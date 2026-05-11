# System Design

## Goal

Answer questions like:

- What did Sarah do today?
- Who moved this client and then followed up?
- What changed in underwriting this morning?
- What work happened outside Blue?

## Principle

Do not try to infer "everything" from one activity page.

Instead:

1. collect events from each system
2. map each event to one employee identity
3. normalize into one event store
4. generate daily summaries and manager answers from that store

## Sources

### Blue

- workspace activity feed
- record lookups
- record moves
- comments
- assignee changes

### Bot

- inbound employee requests
- intent selected
- command executed
- success or failure

### Email

- outbound message metadata
- inbound message metadata
- thread association

### Calendar

- meetings created
- meetings accepted
- meetings attended or completed

### Phone

- inbound and outbound call logs
- duration
- call outcome

### WhatsApp

- bot conversations
- structured actions triggered from chat

## Identity Resolution

Every event has to map back to one employee.

Use `identity_links` to associate:

- Blue user ID
- WhatsApp number
- email address
- phone extension or dialer user ID
- Google or Microsoft account

## Event Pipeline

### Ingestion

- Blue poller or webhook consumer
- bot audit logger
- source-specific import jobs

### Normalization

Convert each raw event into:

- source
- employee
- action type
- affected entity
- timestamp
- summary
- raw payload

### Summarization

For each employee/day:

- count actions by source
- count actions by type
- rank meaningful actions
- produce short manager-readable text

## Query Flow

When a manager asks "What did Sarah do today?":

1. resolve "Sarah" to employee ID
2. load events for today
3. include Blue, bot, email, phone, and calendar events
4. summarize by time and category
5. return concise text plus optional detail drill-down

## Execution Rule

The runtime bot should use one Blue adapter only.

Recommended choice:

- production bot: Blue CLI adapter
- development/operator work: MCP is fine

This avoids mixed execution paths for the same user intent.
