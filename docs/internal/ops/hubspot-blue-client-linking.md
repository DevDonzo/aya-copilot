# HubSpot <-> Blue Client Linking

This runbook is the identity layer behind the live HubSpot <-> Blue comment sync.

Comment sync only works when `client_links` contains a row for the HubSpot
contact and the Blue record.

## Current Design

- HubSpot client object type: `contact`
- Blue workspace: `03 - AYA x Hamza/ AI`
- Blue workspace ID: `cmn524yr800e101mh7kn44mhf`
- Zapier `client_links` table ID: `01KQXATBKWJB6BHM5ZEGZKBJ12`

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
