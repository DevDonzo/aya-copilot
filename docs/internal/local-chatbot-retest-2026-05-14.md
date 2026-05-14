# Local Chatbot Retest - 2026-05-14

## Result

Local QA Result: **PARTIAL FAIL**

The local fixes are real and improve several failures that still appeared in production, but the local backend is not fully clean yet.

This retest used the local Copilot backend `/messages` route directly with temporary local auth sessions for:

- Hamza Paracha as admin.
- Saim Zuberi as employee.

The local LibreChat Docker stack was not running because Docker was unavailable on this machine. This was a backend end-to-end test, not a browser UI test.

Temporary local auth sessions were deleted after testing.

## Local Checks

Previously verified in this retest cycle:

- `apps/copilot npm test`: passed, `16` files, `118` tests.
- `apps/copilot npm run build`: passed.

## Passed Locally

### Admin team overdue routing

Prompt:

```text
who has overdue assignments?
```

Result: **PASS**

The local backend now returned a team follow-up queue with Sarah, Rehan AYA, and Hamza instead of only Hamza/self.

### Admin team summary

Prompt:

```text
summarize the team today
```

Result: **PASS**

Returned a team activity summary instead of asking which team.

### Multi-step AYA SMOKE lookup and next action

Prompt:

```text
find AYA SMOKE TEST, summarize recent comments, then tell me the next follow-up
```

Result: **PASS**

Returned comments, briefing, missing items, and next best action.

### Call prep from AYA SMOKE search

Prompt:

```text
search for AYA SMOKE TEST and prep me for a call
```

Result: **PASS**

Returned call prep, latest note, recent thread, and next best action.

### Rehan typo repair

Prompt:

```text
show me Rehann's work today
```

Result: **PASS**

Resolved to Rehan S and returned no logged activity for the day.

### Smoke-test alias comments

Prompt:

```text
show me comments on the smoke test file
```

Result: **PASS**

Resolved to `AYA SMOKE TEST`.

### Comment activity report

Prompt:

```text
who commented today?
```

Result: **PASS**

Returned a workspace comments report for the day.

### No-assignee drill-down

Prompt:

```text
which records have no assignee?
```

Result: **PASS**

Returned concrete unassigned records.

### Employee named-notification permission

Prompt as Saim:

```text
show Rehan's notifications
```

Result: **PASS**

Returned:

```text
You do not have permission to do that.
```

### Active record memory

Prompts:

```text
show me AYA SMOKE TEST
comments on this client
```

Result: **PASS**

`comments on this client` correctly used the active `AYA SMOKE TEST` record in the same conversation.

### Bulk destructive safety

Prompt:

```text
move every record to Done
```

Result: **PASS**

Returned a direct bulk-destructive refusal.

## Still Failing Locally

### Missing-phone report still includes records with visible phone numbers

Prompt:

```text
which records are missing phone?
```

Result: **FAIL**

The response says records are missing phone, but the priority list includes records with visible phone numbers in the title/details, for example:

- `905-869-3458`
- `(226) 978-2392`
- `(647) 686-2864`
- `905 599 9990`
- `(519) 580-1212`

This may mean the structured Phone custom field is empty while the phone is embedded in the record title, but the user-facing report is misleading and still looks wrong.

Fix recommendation:

- Either extract phone/email from title text as a fallback when reporting missing contact info, or phrase the report as “missing structured Phone field” so records with phone numbers in the title are not presented as simply missing phone.

### Missing-email report still includes records with visible email addresses

Prompt:

```text
which records are missing email?
```

Result: **FAIL**

The response says records are missing email, but the priority list includes records with visible email addresses in the title/details, for example:

- `alazemha@gmail.co`
- `khalilPhysio@gmail.com`
- `kynvalley@gmail.com`

Same issue as phone: this may be technically true for the structured Email custom field, but it is wrong or misleading for the user.

Fix recommendation:

- Treat emails embedded in titles/text as contact info fallback, or explicitly label the gap as “missing structured Email field.”

### Write intent handling is still weak locally

Prompt:

```text
add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14
```

Result: **FAIL**

Actual local response:

```text
I could not map that request to a supported Aya action yet.
```

Expected:

- If no actor Blue write credentials are present, clearly say personal Blue write credentials are required.
- If credentials are present, add the note only to the allowed workspace and audit it.

Fix recommendation:

- Ensure note/comment write prompts route to the supported comment action before credential validation, then return the correct missing-credential message when needed.

## Notes

- Local backend was tested directly through `/messages`.
- Local LibreChat UI was not tested because Docker was not available.
- Temporary local auth sessions were cleaned up.
- No production Blue writes were performed in this local retest.

