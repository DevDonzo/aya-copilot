# AyaFinancial FinOps Bot: Adoption & Roadmap

This document captures practical employee-facing use cases, natural-language prompts, and the long-term strategic roadmap for the AyaFinancial FinOps platform.

## Core Principles

- Employees should talk to Aya like an operations coworker, not like an API.
- Aya should prefer Blue-backed tools for CRM reads and approved writes.
- If a request is ambiguous, Aya should ask one short follow-up question instead of guessing.
- If a financial field would create bad formula output, Aya should ask for missing context instead of inventing values.

## High-Value Employee Use Cases

### 1. Personal workload and prioritization
Employees often want a fast view of what is assigned to them right now.
- `what am i working on`
- `show my open files`
- `what are my open records right now`
- `which clients are assigned to me today`

### 2. Search for a client or lead
Search by **Name, Email, or Phone Number** in seconds.
- `find John Smith`
- `show me sheraz`
- `look up 416-555-0199`
- `search for client@example.com`

### 3. Read the latest comments on a client
Get the context before a call without digging through the CRM.
- `show comments for John Smith`
- `what's in the comments on sheraz`
- `list recent comments for Michael Brown`

### 4. Add a comment or note
Add operational notes in plain language.
- `add note to John Smith: client sent income docs`
- `add comment to sheraz: called twice, no answer`
- `comment on the Patel file: lawyer is waiting for commitment`

### 5. Move a client to the next stage (CRM Flow)
Push files forward instantly after a conversation.
- `move John Smith to 0.2`
- `move sheraz to underwriting`
- `move the Patel file to commitments`

### 6. Create a new lead (Data Entry)
Aya handles the structured extraction (Name, Email, Phone, Amount).
- `create a new lead named john smith phone 4165550123 email john@example.com amount 275000`
- `new lead maria khan, email maria@example.com, phone 6475550101`
- `add a client named david lee with phone 9055550199 and amount 450000`

### 7. Team & Activity Summaries
- `what did i do today`
- `what did the team do today`
- `who had no activity today`
- `what changed today`

---

## 🛡️ Strategic Roadmap (The "Aya Shield" & Pulse)

## Security & Access Control
### Cloudflare Zero Trust (Identity-Aware Proxy)
**Goal:** Prevent the bot from being accessible on the public internet.
- **Strategy:** Use Cloudflare Access to gate `chat.ayafinancial.com`.
- **Policy:** `Allow` if `email` ends with `@ayafinancial.com`.
- **Benefit:** Adds a "Google Login" layer. Even if the bot has a vulnerability, it is invisible to the public web. Only authorized Aya employees can see the login screen.

## Management & Reporting
### The Friday "Pulse" Report
**Goal:** Weekly automated summary for leadership.
- **Logic:** A cron job that runs every Friday at 4:00 PM ET.
- **Content:** 
    - Total CRM records moved/updated via Aya.
    - Identification of **"Stale Leads"** (records with no activity for >10 days).
    - Team productivity metrics (who is the most active closer).
- **Delivery:** Sent as a DM to the Manager in LibreChat or via SendGrid email.

## AI & Logic Enhancements
### Dynamic Model Routing (Cost Optimization)
**Goal:** Automatically use the cheapest model for the task to keep the bill under $15/mo.
- **Strategy:**
    - `gpt-4o-mini` for simple CRM moves/comments ($0.15/1M tokens).
    - `deepseek-v3` for long data summaries and the Weekly Pulse.
    - `claude-4-sonnet` only for complex research or fallback.

### Proactive Webhook Alerts
**Goal:** Move from "Reactive" to "Proactive."
- **Logic:** When a high-priority record is assigned in Blue, Aya should proactively message the employee.
- **Message:** "Hey [Name], a new high-priority lead just hit your pipeline. Want me to summarize their history?"

## Infrastructure Notes
- **RAM Requirement:** Minimum 4GB (8GB preferred) to handle Meilisearch + MongoDB + Aya Bot.
- **Backups:** Enable VPS-level snapshots for the `/app/data` (SQLite) and MongoDB volumes.
- **OpenRouter:** Maintain a $50 credit balance to stay in "Tier 2" for higher rate limits and 99.9% uptime.
