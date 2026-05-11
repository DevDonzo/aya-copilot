#!/usr/bin/env python3
"""Audit and backfill HubSpot <-> Blue client links.

This script inventories HubSpot contacts and Blue records in the allowed
workspace, normalizes identity fields, and produces:

- deterministic matches that are safe to backfill into `client_links`
- ambiguous or missing cases that require manual review

It does not guess across fuzzy matches. Email wins first, then phone, then an
exact normalized full-name fallback only when both sides are otherwise missing
email and phone.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


ALLOWED_WORKSPACE_ID = "cmn524yr800e101mh7kn44mhf"
CLIENT_LINKS_TABLE_ID = "01KQXATBKWJB6BHM5ZEGZKBJ12"
HUBSPOT_CONTACT_OBJECT_TYPE = "contact"

DEFAULT_BLUE_CONFIG = Path.home() / ".config" / "blue" / "config.env"

BLUE_FIELD_IDS = {
    "contact_name": "azct95hahp43jssueal67o89",
    "email": "seele4ni26hb0icae7q43is1",
    "phone": "d4jy3c5fal8wsl0csq37tgq6",
    "first_name": "hrk13g747viwvu4v0rmvowke",
    "last_name": "dpibq4x1x1b499y82hd873la",
}


@dataclass
class BlueRecord:
    id: str
    title: str
    email: Optional[str]
    phone: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    contact_name: Optional[str]
    linked: bool

    @property
    def normalized_email(self) -> Optional[str]:
        return normalize_email(self.email)

    @property
    def normalized_phone(self) -> Optional[str]:
        return normalize_phone(self.phone)

    @property
    def normalized_name(self) -> Optional[str]:
        return normalize_name(
            build_name(
                first_name=self.first_name,
                last_name=self.last_name,
                contact_name=self.contact_name,
                fallback_title=self.title,
            )
        )


@dataclass
class HubSpotContact:
    id: str
    firstname: Optional[str]
    lastname: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    linked: bool

    @property
    def normalized_email(self) -> Optional[str]:
        return normalize_email(self.email)

    @property
    def normalized_phone(self) -> Optional[str]:
        return normalize_phone(self.phone)

    @property
    def normalized_name(self) -> Optional[str]:
        return normalize_name(build_name(self.firstname, self.lastname))


def load_dotenv(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def normalize_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    value = value.strip().lower()
    return value or None


def normalize_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits or None


def normalize_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    value = value.lower()
    value = re.sub(r"[^a-z0-9\s'-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def build_name(
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    contact_name: Optional[str] = None,
    fallback_title: Optional[str] = None,
) -> Optional[str]:
    parts = []
    if first_name:
        parts.append(first_name.strip())
    if last_name:
        parts.append(last_name.strip())
    if parts:
        return " ".join(part for part in parts if part)
    if contact_name:
        return contact_name.strip()
    if fallback_title:
        return fallback_title.strip()
    return None


def load_blue_auth(config_path: Path) -> Dict[str, str]:
    values = {
        **load_dotenv(config_path),
        **os.environ,
    }
    mapping = {
        "token_id": values.get("BLUE_TOKEN_ID") or values.get("CLIENT_ID"),
        "token_secret": values.get("BLUE_TOKEN_SECRET") or values.get("AUTH_TOKEN"),
        "company_id": values.get("BLUE_COMPANY_ID") or values.get("COMPANY_ID"),
        "project_id": values.get("BLUE_PROJECT_ID") or values.get("PROJECT_ID"),
        "base_url": values.get("BLUE_API_URL") or values.get("API_URL") or "https://app.blue.cc/graphql",
    }
    missing = [key for key, value in mapping.items() if key != "project_id" and not value]
    if missing:
        raise RuntimeError(
            f"Missing Blue auth values ({', '.join(missing)}) in env or {config_path}"
        )
    return mapping


def fetch_blue_records(auth: Dict[str, str], workspace_id: str) -> List[BlueRecord]:
    headers = {
        "content-type": "application/json",
        "x-bloo-token-id": auth["token_id"],
        "x-bloo-token-secret": auth["token_secret"],
        "x-bloo-company-id": auth["company_id"],
        "x-bloo-project-id": auth.get("project_id") or workspace_id,
    }
    url = auth["base_url"]
    query = """
    query PairingRecords($filter: TodosFilter!, $limit: Int, $skip: Int) {
      todoQueries {
        todos(filter: $filter, limit: $limit, skip: $skip) {
          items {
            id
            title
            customFields {
              id
              value
            }
          }
        }
      }
    }
    """
    results: List[BlueRecord] = []
    limit = 500
    skip = 0
    while True:
        payload = {
            "query": query,
            "variables": {
                "filter": {"companyIds": [], "projectIds": [workspace_id]},
                "limit": limit,
                "skip": skip,
            },
        }
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        response.raise_for_status()
        body = response.json()
        if body.get("errors"):
            raise RuntimeError(f"Blue GraphQL returned errors: {body['errors']}")
        items = body["data"]["todoQueries"]["todos"]["items"]
        if not items:
            break
        for item in items:
            custom_fields = {
                field["id"]: field.get("value")
                for field in item.get("customFields", [])
                if field.get("id")
            }
            results.append(
                BlueRecord(
                    id=item["id"],
                    title=item.get("title") or "",
                    email=stringify_field(custom_fields.get(BLUE_FIELD_IDS["email"])),
                    phone=stringify_field(custom_fields.get(BLUE_FIELD_IDS["phone"])),
                    first_name=stringify_field(custom_fields.get(BLUE_FIELD_IDS["first_name"])),
                    last_name=stringify_field(custom_fields.get(BLUE_FIELD_IDS["last_name"])),
                    contact_name=stringify_field(custom_fields.get(BLUE_FIELD_IDS["contact_name"])),
                    linked=False,
                )
            )
        if len(items) < limit:
            break
        skip += limit
    return results


def stringify_field(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, list):
        flattened = [str(item).strip() for item in value if str(item).strip()]
        return ", ".join(flattened) if flattened else None
    text = str(value).strip()
    return text or None


def fetch_hubspot_contacts(token: str, limit: Optional[int] = None) -> List[HubSpotContact]:
    url = "https://api.hubapi.com/crm/v3/objects/contacts/search"
    headers = {
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
    }
    contacts: List[HubSpotContact] = []
    after: Optional[str] = None
    page_size = 100
    hard_cap = limit or 10000
    while True:
        body: Dict[str, Any] = {
            "limit": page_size,
            "properties": ["firstname", "lastname", "email", "phone"],
        }
        if after:
            body["after"] = after
        response = requests.post(url, headers=headers, json=body, timeout=60)
        if response.status_code >= 400:
            if len(contacts) >= hard_cap:
                break
            response.raise_for_status()
        payload = response.json()
        for row in payload.get("results", []):
            props = row.get("properties", {})
            contacts.append(
                HubSpotContact(
                    id=row["id"],
                    firstname=props.get("firstname"),
                    lastname=props.get("lastname"),
                    email=props.get("email"),
                    phone=props.get("phone"),
                    linked=False,
                )
            )
            if len(contacts) >= hard_cap:
                return contacts
        paging = payload.get("paging", {})
        next_link = paging.get("next", {})
        after = next_link.get("after")
        if not after:
            break
    return contacts


def load_existing_links(path: Optional[Path]) -> Tuple[set[str], set[str], List[Dict[str, str]]]:
    if not path:
        return set(), set(), []
    rows: List[Dict[str, str]] = []
    text = path.read_text()
    if path.suffix.lower() == ".json" or text.lstrip().startswith(("[", "{")):
        rows = json.loads(text)
        if isinstance(rows, dict):
            rows = [rows]
    else:
        with path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)
    hub_ids = set()
    blue_ids = set()
    for row in rows:
        hub_id = str(row.get("hubspot_object_id") or row.get("f2") or "").strip()
        blue_id = str(row.get("blue_record_id") or row.get("f3") or "").strip()
        if hub_id:
            hub_ids.add(hub_id)
        if blue_id:
            blue_ids.add(blue_id)
    return hub_ids, blue_ids, rows


def index_unique(
    items: Iterable[Any],
    key_fn,
) -> Dict[str, List[Any]]:
    index: Dict[str, List[Any]] = defaultdict(list)
    for item in items:
        key = key_fn(item)
        if key:
            index[key].append(item)
    return index


def build_matches(
    blue_records: List[BlueRecord],
    hub_contacts: List[HubSpotContact],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Counter]:
    hub_by_email = index_unique(hub_contacts, lambda row: row.normalized_email)
    hub_by_phone = index_unique(hub_contacts, lambda row: row.normalized_phone)
    hub_by_name = index_unique(hub_contacts, lambda row: row.normalized_name)

    safe_matches: List[Dict[str, Any]] = []
    manual_review: List[Dict[str, Any]] = []
    stats = Counter()

    for blue in blue_records:
        email = blue.normalized_email
        phone = blue.normalized_phone
        name = blue.normalized_name

        email_candidates = hub_by_email.get(email, []) if email else []
        phone_candidates = hub_by_phone.get(phone, []) if phone else []
        name_candidates = hub_by_name.get(name, []) if name else []

        if email and len(email_candidates) == 1:
            hub = email_candidates[0]
            if phone and hub.normalized_phone and phone != hub.normalized_phone:
                stats["email_phone_conflict"] += 1
                manual_review.append(review_row("email_phone_conflict", blue, email_candidates, phone_candidates, name_candidates))
                continue
            stats["safe_email"] += 1
            safe_matches.append(match_row("email", blue, hub))
            continue

        if email and len(email_candidates) > 1:
            stats["ambiguous_email"] += 1
            manual_review.append(review_row("ambiguous_email", blue, email_candidates, phone_candidates, name_candidates))
            continue

        if phone and len(phone_candidates) == 1:
            hub = phone_candidates[0]
            if email and hub.normalized_email and email != hub.normalized_email:
                stats["phone_email_conflict"] += 1
                manual_review.append(review_row("phone_email_conflict", blue, email_candidates, phone_candidates, name_candidates))
                continue
            stats["safe_phone"] += 1
            safe_matches.append(match_row("phone", blue, hub))
            continue

        if phone and len(phone_candidates) > 1:
            stats["ambiguous_phone"] += 1
            manual_review.append(review_row("ambiguous_phone", blue, email_candidates, phone_candidates, name_candidates))
            continue

        if name and not email and not phone and len(name_candidates) == 1:
            hub = name_candidates[0]
            if hub.normalized_email or hub.normalized_phone:
                stats["name_needs_review"] += 1
                manual_review.append(review_row("name_needs_review", blue, email_candidates, phone_candidates, name_candidates))
                continue
            stats["safe_name"] += 1
            safe_matches.append(match_row("name", blue, hub))
            continue

        if name and len(name_candidates) > 1:
            stats["ambiguous_name"] += 1
            manual_review.append(review_row("ambiguous_name", blue, email_candidates, phone_candidates, name_candidates))
            continue

        if not email and not phone and not name:
            stats["missing_all_keys"] += 1
            manual_review.append(review_row("missing_all_keys", blue, email_candidates, phone_candidates, name_candidates))
            continue

        stats["no_hub_candidate"] += 1
        manual_review.append(review_row("no_hub_candidate", blue, email_candidates, phone_candidates, name_candidates))

    return safe_matches, manual_review, stats


def match_row(strategy: str, blue: BlueRecord, hub: HubSpotContact) -> Dict[str, Any]:
    return {
        "hubspot_object_type": HUBSPOT_CONTACT_OBJECT_TYPE,
        "hubspot_object_id": hub.id,
        "blue_record_id": blue.id,
        "blue_workspace_id": ALLOWED_WORKSPACE_ID,
        "status": "active",
        "match_strategy": strategy,
        "blue_title": blue.title,
        "blue_email": blue.normalized_email,
        "blue_phone": blue.normalized_phone,
        "blue_name": blue.normalized_name,
        "hubspot_email": hub.normalized_email,
        "hubspot_phone": hub.normalized_phone,
        "hubspot_name": hub.normalized_name,
    }


def review_row(
    reason: str,
    blue: BlueRecord,
    email_candidates: List[HubSpotContact],
    phone_candidates: List[HubSpotContact],
    name_candidates: List[HubSpotContact],
) -> Dict[str, Any]:
    def ids(rows: List[HubSpotContact]) -> List[str]:
        return [row.id for row in rows]

    return {
        "reason": reason,
        "blue_record_id": blue.id,
        "blue_title": blue.title,
        "blue_email": blue.normalized_email,
        "blue_phone": blue.normalized_phone,
        "blue_name": blue.normalized_name,
        "email_candidate_ids": ids(email_candidates),
        "phone_candidate_ids": ids(phone_candidates),
        "name_candidate_ids": ids(name_candidates),
    }


def ensure_output_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    key: json.dumps(value) if isinstance(value, list) else value
                    for key, value in row.items()
                }
            )


def build_summary(
    blue_records: List[BlueRecord],
    hub_contacts: List[HubSpotContact],
    existing_links_count: int,
    safe_matches: List[Dict[str, Any]],
    manual_review: List[Dict[str, Any]],
    stats: Counter,
) -> Dict[str, Any]:
    return {
        "allowed_workspace_id": ALLOWED_WORKSPACE_ID,
        "client_links_table_id": CLIENT_LINKS_TABLE_ID,
        "hubspot_object_type": HUBSPOT_CONTACT_OBJECT_TYPE,
        "existing_client_links": existing_links_count,
        "blue_records_total": len(blue_records),
        "hubspot_contacts_total": len(hub_contacts),
        "safe_matches_total": len(safe_matches),
        "manual_review_total": len(manual_review),
        "stats": dict(stats),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--hubspot-token",
        default=os.environ.get("HUBSPOT_PRIVATE_APP_TOKEN"),
        help="HubSpot private app token. Defaults to HUBSPOT_PRIVATE_APP_TOKEN.",
    )
    parser.add_argument(
        "--blue-config",
        type=Path,
        default=DEFAULT_BLUE_CONFIG,
        help=f"Blue config file. Defaults to {DEFAULT_BLUE_CONFIG}.",
    )
    parser.add_argument(
        "--workspace-id",
        default=ALLOWED_WORKSPACE_ID,
        help="Blue workspace ID. Defaults to the allowed workspace.",
    )
    parser.add_argument(
        "--existing-links",
        type=Path,
        help="Optional CSV or JSON export of existing client_links rows to exclude.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/internal/ops/hubspot-blue-client-linking"),
        help="Directory for generated outputs.",
    )
    parser.add_argument(
        "--hubspot-limit",
        type=int,
        default=None,
        help="Optional cap for fetched HubSpot contacts while testing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workspace_id != ALLOWED_WORKSPACE_ID:
        raise RuntimeError(
            f"Refusing to run outside allowed workspace {ALLOWED_WORKSPACE_ID}; got {args.workspace_id}"
        )
    if not args.hubspot_token:
        raise RuntimeError("Missing HubSpot token. Set HUBSPOT_PRIVATE_APP_TOKEN or pass --hubspot-token.")

    blue_auth = load_blue_auth(args.blue_config)
    existing_hub_ids, existing_blue_ids, existing_rows = load_existing_links(args.existing_links)

    blue_records = fetch_blue_records(blue_auth, args.workspace_id)
    hub_contacts = fetch_hubspot_contacts(args.hubspot_token, args.hubspot_limit)

    for record in blue_records:
        record.linked = record.id in existing_blue_ids
    for contact in hub_contacts:
        contact.linked = contact.id in existing_hub_ids

    unlinked_blue = [row for row in blue_records if not row.linked]
    unlinked_hub = [row for row in hub_contacts if not row.linked]

    safe_matches, manual_review, stats = build_matches(unlinked_blue, unlinked_hub)
    output_dir = ensure_output_dir(args.output_dir)

    summary = build_summary(
        blue_records=blue_records,
        hub_contacts=hub_contacts,
        existing_links_count=len(existing_rows),
        safe_matches=safe_matches,
        manual_review=manual_review,
        stats=stats,
    )
    summary["blue_unlinked_total"] = len(unlinked_blue)
    summary["hubspot_unlinked_total"] = len(unlinked_hub)

    write_json(output_dir / "summary.json", summary)
    write_json(output_dir / "safe_matches.json", safe_matches)
    write_json(output_dir / "manual_review.json", manual_review)

    write_csv(
        output_dir / "safe_matches.client_links.csv",
        safe_matches,
        [
            "hubspot_object_type",
            "hubspot_object_id",
            "blue_record_id",
            "blue_workspace_id",
            "status",
            "match_strategy",
            "blue_title",
            "blue_email",
            "blue_phone",
            "blue_name",
            "hubspot_email",
            "hubspot_phone",
            "hubspot_name",
        ],
    )
    write_csv(
        output_dir / "manual_review.csv",
        manual_review,
        [
            "reason",
            "blue_record_id",
            "blue_title",
            "blue_email",
            "blue_phone",
            "blue_name",
            "email_candidate_ids",
            "phone_candidate_ids",
            "name_candidate_ids",
        ],
    )

    print(json.dumps(summary, indent=2))
    print(f"Wrote outputs to {output_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except requests.HTTPError as exc:
        body = exc.response.text[:1000] if exc.response is not None else str(exc)
        print(body, file=sys.stderr)
        raise
