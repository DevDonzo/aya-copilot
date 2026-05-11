# HubSpot <-> Blue Client Linking

This runbook is the identity layer behind the live HubSpot <-> Blue comment sync.

Comment sync only works when `client_links` contains a row for the HubSpot
contact and the Blue record.

## Current Design

- HubSpot client object type: `contact`
- Blue workspace: `03 - AYA x Hamza/ AI`
- Blue workspace ID: `cmn524yr800e101mh7kn44mhf`
- Zapier `client_links` table ID: `01KQXATBKWJB6BHM5ZEGZKBJ12`

## Live Zap Inventory

- `362818638`: `HubSpot Note to Blue Comment Sync with Deduplication`
- `360989284`: `Blue Comments to HubSpot Notes Sync with Deduplication`
- `362995968`: `client_links-Zap 3` for HubSpot contact -> Blue record pairing
- `363210584`: `(Copy) client_links-Zap 3` for Blue record -> HubSpot contact pairing

The older untitled Zap `360956408` should remain disabled.

As of the 2026-05-11 handoff check, all four live Zaps are configured and
tested, but intentionally disabled until the demo/handoff:

- `360989284`: disabled
- `362818638`: disabled
- `362995968`: disabled
- `363210584`: disabled, current version `v3`

Each `client_links` row must contain:

- `hubspot_object_type`
- `hubspot_object_id`
- `blue_record_id`
- `blue_workspace_id`
- `status`

## Repo Tooling

Use [hubspot_blue_client_links.py](/Users/hparacha/AyaFinancial/Blue/scripts/hubspot_blue_client_links.py)
to audit current HubSpot contacts and Blue records and export:

- deterministic safe matches for `client_links`
- manual review cases

The script uses these matching rules:

1. exact normalized email
2. exact normalized phone
3. exact normalized full name only when both sides are otherwise missing email and phone

It intentionally does not do fuzzy matching.

## Inputs

Required:

- `HUBSPOT_PRIVATE_APP_TOKEN`
- local Blue API config in `~/.config/blue/config.env`

Optional:

- an exported `client_links` CSV or JSON file so already-linked rows are excluded

## Run

```bash
cd /Users/hparacha/AyaFinancial/Blue
export HUBSPOT_PRIVATE_APP_TOKEN=...
python3 scripts/hubspot_blue_client_links.py \
  --existing-links /path/to/client_links.csv \
  --output-dir docs/internal/ops/hubspot-blue-client-linking/run-YYYYMMDD
```

Outputs:

- `summary.json`
- `safe_matches.json`
- `safe_matches.client_links.csv`
- `manual_review.json`
- `manual_review.csv`

## Apply Backfill

Use `safe_matches.client_links.csv` to backfill the Zapier `client_links` table.

The file is intentionally shaped to map directly to the table columns:

- `hubspot_object_type`
- `hubspot_object_id`
- `blue_record_id`
- `blue_workspace_id`
- `status`

Do not bulk-import `manual_review.csv`. Those rows need confirmation first.

## Future Pairing Requirement

For new clients, comment sync depends on automation that does both:

1. creates or finds the counterpart record
2. writes the `client_links` row immediately

If either system creates a client without a `client_links` row, comment sync for
that client will fail or be delayed until backfilled.

## Verification Log

### 2026-05-11

Test pair:

- HubSpot contact ID: `219922526227`
- Blue record ID: `86696418160244779156eb605ab18e17`
- Blue workspace ID: `cmn524yr800e101mh7kn44mhf`
- Blue list: `d9ub4nq9nj71t9xi6imenj0m` / `🧰 0 - Leads/Tasks`

Verified live comment sync:

- Blue -> HubSpot create: Blue comment `cmp1cglb10lums601b77nuosd` created HubSpot note `109432017315`.
- Blue -> HubSpot update: updating the Blue comment updated HubSpot note `109432017315`.
- Blue -> HubSpot delete: deleting the Blue comment deleted HubSpot note `109432017315`.
- HubSpot -> Blue create: HubSpot note `109432004903` created Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.
- HubSpot -> Blue update: updating HubSpot note `109432004903` updated Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.
- HubSpot -> Blue delete: deleting HubSpot note `109432004903` deleted Blue comment `cmp1cl7sp07kemm01ej4yjfwd`.

Cleanup:

- The temporary HubSpot notes above were deleted.
- The temporary Blue comments above were deleted.
- The test record comment count returned to `14`.

Observed Zapier delay for comment events was roughly 70-110 seconds because the
comment-sync Zaps include delay steps for deduplication and loop prevention.

Additional future-client pairing verification:

- HubSpot-created contact -> Blue record pairing passed.
- Blue-created record -> HubSpot contact pairing initially created the HubSpot
  contact but did not create a usable `client_links` row.
- Root cause: Zap `363210584` step `363210588` mapped `blue_record_id` from
  non-existent step `363210587`.
- Fix: published Zap `363210584` version `v3` with `blue_record_id` mapped to
  the Blue trigger step ID: `{{=gives['363210584']["id"]}}`.

Fresh Blue-first verification after the fix:

- Temporary Blue record `aacc2db0c0d345e19761f570b5a53cf9` created temporary
  HubSpot contact `220945143223`.
- Blue -> HubSpot create passed: Blue comment `cmp1efm3q08f8mm01c9185l2i`
  created HubSpot note `109456903782`.
- HubSpot -> Blue create passed: HubSpot note `109448851764` created Blue
  comment `cmp1ek33l0ivcpd01knge04ml`.

Cleanup:

- Temporary HubSpot contacts `220945143223`, `220940250210`, and
  `220930225067` were deleted.
- Temporary HubSpot notes `109456903782`, `109448851764`, `109432546231`,
  `109432319797`, `109432017315`, and `109432004903` were deleted.
- Temporary Blue records `aacc2db0c0d345e19761f570b5a53cf9`,
  `634f286d48de4067bd2defa2b7d3f454`, and
  `d8cbc237b9fc4070af2e7fa813e9f615` were deleted from workspace
  `cmn524yr800e101mh7kn44mhf`.
