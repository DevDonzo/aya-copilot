# Zapier <-> Blue Handoff

This is the single handoff file for the HubSpot <-> Zapier <-> Blue comment
sync.

No production Blue writes were performed during verification.

## Summary

The system syncs HubSpot contact notes with Blue record comments.

- HubSpot side: contact notes
- Blue side: record comments
- Identity layer: Zapier Tables `client_links`
- Comment dedupe layer: Zapier Tables `comment_links`
- Tested workspace: `03 - AYA x Hamza/ AI`
- Production target workspace: `00- AYA Sales CRM 3`

The sync is configured and tested, but the Zaps are intentionally disabled until
the demo/handoff.

## Current Zap Status

As of the 2026-05-11 handoff check, these four Zaps are configured, tested, and
disabled:

- `360989284`: `Blue Comments to HubSpot Notes Sync with Deduplication`
- `362818638`: `HubSpot Note to Blue Comment Sync with Deduplication`
- `362995968`: `client_links-Zap 3`
- `363210584`: `(Copy) client_links-Zap 3`, current version `v3`

The older untitled Zap `360956408` should stay disabled.

Speed configuration applied on 2026-05-11:

- `360989284` current version `v14`: `Reduce queue delay to 15s`
- `362818638` current version `v3`: `Reduce queue delay to 15s`
- Both comment-sync Delay by Zapier queue steps now use `0.25 minutes`.
- This reduces the fixed dedupe queue wait from 60 seconds to 15 seconds.

Blue webhook state after disabling the Zaps:

- `Zapier Blue -> HubSpot Comments`
- webhook ID: `cmothmyhu0bnylm01d0iurkol`
- status: `HEALTHY`
- enabled: `false`
- scoped workspace: `cmn524yr800e101mh7kn44mhf`
- URL: `https://hooks.zapier.com/hooks/catch/27254550/ujjh22i/`

Before any live demo or renewed test, turn on the Zapier side first, then
reactivate this Blue webhook in Blue so the endpoint health check can pass.

## Workspace Scope

Current test workspace:

- Name: `03 - AYA x Hamza/ AI`
- Workspace ID: `cmn524yr800e101mh7kn44mhf`
- Default lead list: `🧰 0 - Leads/Tasks`
- Default lead list ID: `d9ub4nq9nj71t9xi6imenj0m`

Production target workspace:

- Name: `00- AYA Sales CRM 3`
- Workspace ID: `cmhazc4rl1vkand1eonnmiyjy`
- Default lead list: `🧰 0 - Leads/Tasks`
- Default lead list ID: `cmhazh5l81sh3qk1e9zf3d8z9`

## How It Works

Comment sync only works when the same client has a row in the `client_links`
Zapier table.

Each `client_links` row must contain:

- `hubspot_object_type`
- `hubspot_object_id`
- `blue_record_id`
- `blue_workspace_id`
- `status`

For this implementation:

- `hubspot_object_type` is `contact`
- active rows use `status = active`
- test rows use `blue_workspace_id = cmn524yr800e101mh7kn44mhf`
- production rows must use `blue_workspace_id = cmhazc4rl1vkand1eonnmiyjy`

The `comment_links` table maps HubSpot note IDs to Blue comment IDs so the Zaps
can update/delete the synced counterpart and avoid duplicate loopbacks.

## Zapier Tables

`client_links` table:

```text
01KQXATBKWJB6BHM5ZEGZKBJ12
```

Required production row values:

```text
hubspot_object_type = contact
blue_workspace_id = cmhazc4rl1vkand1eonnmiyjy
status = active
```

Do not mix test and production rows for the same HubSpot contact. If a contact
already has a test row, mark that row inactive or create the production row only
after confirming the correct production Blue record.

## Tested Behavior

Verified on 2026-05-11 against the test workspace.

Existing mapped test pair:

- HubSpot contact ID: `219922526227`
- Blue record ID: `86696418160244779156eb605ab18e17`
- Blue workspace ID: `cmn524yr800e101mh7kn44mhf`
- Blue list ID: `d9ub4nq9nj71t9xi6imenj0m`

Verified comment sync:

- Blue -> HubSpot create: Blue comment `cmp1cglb10lums601b77nuosd` created HubSpot note `109432017315`.
- Blue -> HubSpot update: updating the Blue comment updated HubSpot note `109432017315`.
- Blue -> HubSpot delete: deleting the Blue comment deleted HubSpot note `109432017315`.
- HubSpot -> Blue create: HubSpot note `109432004903` created Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.
- HubSpot -> Blue update: updating HubSpot note `109432004903` updated Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.
- HubSpot -> Blue delete: deleting HubSpot note `109432004903` deleted Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.

Future-client pairing verification:

- HubSpot-created contact -> Blue record pairing passed.
- Blue-created record -> HubSpot contact pairing passed after the `363210584` v3 fix.
- Fresh Blue-first test record `aacc2db0c0d345e19761f570b5a53cf9` created HubSpot contact `220945143223`.
- Blue -> HubSpot create passed: Blue comment `cmp1efm3q08f8mm01c9185l2i` created HubSpot note `109456903782`.
- HubSpot -> Blue create passed: HubSpot note `109448851764` created Blue comment `cmp1ek33l0ivcpd01knge04ml`.

Observed processing delay from the 2026-05-11 stress test:

- HubSpot-created contact -> Blue record pairing passed.
- Blue-created record -> HubSpot contact pairing passed in 126.9 seconds.
- Six comment create-sync checks passed across both directions.
- Comment create-sync delay range: 33.9-162.4 seconds.
- Blue comment update -> HubSpot note update passed in 186.7 seconds.
- Blue comment delete -> HubSpot note delete passed in 74.7 seconds.

These stress-test timings were captured before the fixed queue delay was reduced
from 60 seconds to 15 seconds. The new setting should remove roughly 45 seconds
from the fixed wait, but Zapier scheduling, HubSpot indexing, and API runtime can
still add variable latency.

For live demos, expect comments/notes to usually appear in under 1-2 minutes, but
do not promise instant sync. Wait up to 4 minutes before declaring a sync failure
because update propagation can still run over the expected window.

Cleanup completed:

- Temporary HubSpot contacts `220945143223`, `220940250210`, and `220930225067` were deleted.
- Temporary HubSpot notes `109456903782`, `109448851764`, `109432546231`, `109432319797`, `109432017315`, and `109432004903` were deleted.
- Temporary Blue records `aacc2db0c0d345e19761f570b5a53cf9`, `634f286d48de4067bd2defa2b7d3f454`, and `d8cbc237b9fc4070af2e7fa813e9f615` were deleted from the test workspace.
- Temporary stress-test HubSpot contacts `220976071444` and `220947988262` were deleted.
- Temporary stress-test HubSpot notes `109455142693`, `109441966135`, `109454195854`, `109435266936`, `109457472257`, and `109455758263` were deleted.
- Temporary stress-test Blue records `fa31b4355dac424682f9d676f7bf71df` and `474d067310704d9f9e07b473c55c85c0` were deleted from the test workspace.

## Important Fix Already Applied

Zap `363210584` had a broken Blue-first pairing mapping.

Root cause:

- step `363210588` mapped `blue_record_id` from a non-existent step `363210587`

Fix:

- published Zap `363210584` version `v3`
- `blue_record_id` now maps to the Blue trigger step:

```text
{{=gives['363210584']["id"]}}
```

Do not change this mapping during production cutover.

## Production Cutover

The production cutover is a configuration change, not a Blue data migration.

Current test value:

```text
cmn524yr800e101mh7kn44mhf
```

Production value:

```text
cmhazc4rl1vkand1eonnmiyjy
```

Make the following changes while all four Zaps are disabled.

### `362995968`: HubSpot Contact -> Blue Record Pairing

Update step `362996336`:

- `projectIds`: from `cmn524yr800e101mh7kn44mhf` to `cmhazc4rl1vkand1eonnmiyjy`
- `todoListId`: from `d9ub4nq9nj71t9xi6imenj0m` to `cmhazh5l81sh3qk1e9zf3d8z9`

Update step `362996340`:

- `new__data__f4`: from `cmn524yr800e101mh7kn44mhf` to `cmhazc4rl1vkand1eonnmiyjy`

`new__data__f4` is the `blue_workspace_id` column in `client_links`.

### `363210584`: Blue Record -> HubSpot Contact Pairing

Update trigger step `363210584`:

- `projectIds`: from `cmn524yr800e101mh7kn44mhf` to `cmhazc4rl1vkand1eonnmiyjy`

Update step `363210588`:

- `new__data__f4`: from `cmn524yr800e101mh7kn44mhf` to `cmhazc4rl1vkand1eonnmiyjy`

Do not change `new__data__f3`.

### `362818638`: HubSpot Note -> Blue Comment Sync

Update code step `362827969`:

- replace fallback workspace ID `cmn524yr800e101mh7kn44mhf` with `cmhazc4rl1vkand1eonnmiyjy`

Safer production option:

- remove the fallback and fail the Zap run if `client_links` does not provide `blue_workspace_id`

That prevents accidental writes to the wrong Blue workspace.

### `360989284`: Blue Comment -> HubSpot Note Sync

The current Zap definition does not contain the hard-coded test workspace ID in
its ZDL.

Production switch depends on the Blue outgoing webhook:

- create or update the production Blue webhook to point at this Zap's catch hook
- scope the webhook to `cmhazc4rl1vkand1eonnmiyjy`
- disable/remove the test workspace webhook before production is turned on

## Current Client Backfill

Before enabling comment sync in production, backfill `client_links` for current
production clients.

Repo audit tool:

```bash
scripts/hubspot_blue_client_links.py
```

This script inventories HubSpot contacts and Blue records and exports:

- `summary.json`
- `safe_matches.json`
- `safe_matches.client_links.csv`
- `manual_review.json`
- `manual_review.csv`

Matching rules:

1. exact normalized email
2. exact normalized phone
3. exact normalized full name only when both sides are otherwise missing email and phone

Do not bulk-import `manual_review.csv`.

Important production note:

- the script currently has a safety guard for the test workspace
- for production, update the allowlist in a reviewed production branch or prepare the production `client_links` import manually

## Demo / Handoff Test

For the demo, after switching the config to production, turn on the Zaps in this
order:

1. `362995968`
2. `363210584`
3. `360989284`
4. `362818638`

After `360989284` is on, reactivate the Blue outbound webhook for
Blue -> HubSpot comment events. Blue performs a health check when the webhook is
enabled, and the endpoint must return a 2xx response.

Smoke test:

1. Create one controlled HubSpot contact.
2. Confirm a Blue production record is created in `cmhazc4rl1vkand1eonnmiyjy`.
3. Confirm a `client_links` row exists with the HubSpot contact ID and Blue record ID.
4. Add a Blue comment on the linked production record.
5. Confirm a HubSpot note appears on the linked contact.
6. Add a HubSpot note on the linked contact.
7. Confirm a Blue comment appears on the linked production record.
8. Wait up to 4 minutes before declaring failure, because the Zaps still include a 15-second dedupe queue plus Zapier/HubSpot runtime latency.

## Rollback

If anything behaves incorrectly:

1. Disable all four Zaps immediately.
2. Disable the production Blue outgoing webhook.
3. Mark incorrect `client_links` rows as inactive.
4. Delete only confirmed test artifacts.
5. Do not delete real production notes/comments unless the business owner confirms they were created by the failed test.

## Acceptance Criteria

Production is ready only when all of these pass:

- new HubSpot contact creates a Blue production record and a `client_links` row
- new Blue production record creates a HubSpot contact and a `client_links` row
- HubSpot note creates a Blue comment on the linked production record
- Blue comment creates a HubSpot note on the linked contact
- update/delete behavior is verified or explicitly deferred
- all four Zaps are enabled only after the smoke test passes
