# Aya local demo runbook

Local URL

- `http://127.0.0.1:3010/admin`

Demo credentials

- Admin
  - `employeeName`: `Hamza Paracha`
  - `password`: `AyaDemo2026!`
- Employee
  - `employeeName`: `Sarah Khan`
  - `password`: `AyaEmployee2026!`

Use the admin account for the full demo.

Recommended demo flow

1. Log in as `Hamza Paracha`.
2. Open the `Aya chat` view.
3. Run `start my day`.
4. Run `show my notifications`.
5. Run `show my assignments`.
6. Run `what did Hamza do today`.
7. Run `show reporting`.
8. Run `add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: demo note from local run`.
9. Run `set due date for AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22 to 2026-05-14`.
10. Run `mark Usman - webworx done`.

Expected results

- `start my day`: daily brief with assignments, priorities, and activity summary
- `show my notifications`: notification feed with recent assigned-file changes
- `show my assignments`: Hamza's open assigned files
- `what did Hamza do today`: admin activity summary and audit-style breakdown
- `show reporting`: Blue reporting assets in the allowed workspace
- `add follow up note ...`: successful live comment on the smoke-test record
- `set due date ...`: successful due-date update on the smoke-test record
- `mark Usman - webworx done`: safe refusal, proving Aya no longer guesses on ambiguous writes

Demo notes

- Use the smoke-test record for all live writes.
- Do not use customer records for live write demonstrations.
- The safety-refusal step is intentional and is part of the demo.
