# Aya local demo runbook

Use LibreChat as the demo surface. The separate Aya admin dashboard has been removed.

Local chat URL:

- `http://127.0.0.1:3080`

Production chat URL:

- `https://copilot.ayafinancial.com`

Recommended read-only demo prompts:

1. `hello`
2. `what can you do for Aya Financial?`
3. `show my assignments`
4. `where have I been mentioned?`
5. `show recent comments on AYA SMOKE TEST - OpenAI gpt-4o-mini`
6. `who did what today?`
7. `what is Hamza working on?`
8. `show employee workload`

Optional write demo prompts:

1. `add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: demo handoff note`
2. `mark AYA SMOKE TEST - OpenAI gpt-4o-mini complete`

Expected write-demo behavior:

- Aya should use the allowed Blue workspace only.
- Aya should keep record context across the follow-up.
- If a stage name is ambiguous, Aya should ask for clarification instead of guessing.

Demo safety notes:

- Use the smoke-test record for live writes.
- Do not use customer records for live write demonstrations.
- Use read-only prompts if you are unsure which Blue credential is connected.
