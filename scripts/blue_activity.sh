#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${HOME}/.config/blue/config.env"
DEFAULT_PROJECT_ID="cmhazc4rl1vkand1eonnmiyjy"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing Blue config at ${CONFIG_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${CONFIG_FILE}"
set +a

: "${API_URL:?Missing API_URL in ${CONFIG_FILE}}"
: "${CLIENT_ID:?Missing CLIENT_ID in ${CONFIG_FILE}}"
: "${AUTH_TOKEN:?Missing AUTH_TOKEN in ${CONFIG_FILE}}"

PROJECT_ID="${DEFAULT_PROJECT_ID}"
USER_ID=""
LIMIT=20
RAW=0

usage() {
  cat <<'EOF'
Usage: blue_activity.sh [--project PROJECT_ID] [--user USER_ID] [--limit N] [--raw]

Defaults to the allowed workspace:
  cmhazc4rl1vkand1eonnmiyjy

Examples:
  ./scripts/blue_activity.sh
  ./scripts/blue_activity.sh --limit 50
  ./scripts/blue_activity.sh --user cm2or9cai0j7pcacvqx3kgvxz
  ./scripts/blue_activity.sh --project cmhazc4rl1vkand1eonnmiyjy --raw
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --user)
      USER_ID="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-20}"
      shift 2
      ;;
    --raw)
      RAW=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

QUERY='query ActivityList($projectId: String!, $userId: String, $first: Int!) {
  activityList(projectId: $projectId, userId: $userId, first: $first, orderBy: createdAt_DESC) {
    activities {
      id
      category
      html
      createdAt
      createdBy {
        id
        fullName
        firstName
        lastName
        email
      }
      affectedBy {
        id
        fullName
        firstName
        lastName
      }
      project {
        id
        name
        slug
      }
      todo {
        id
        title
      }
      comment {
        id
        text
      }
    }
    totalCount
  }
}'

response="$(
  jq -n \
    --arg query "${QUERY}" \
    --arg projectId "${PROJECT_ID}" \
    --arg userId "${USER_ID}" \
    --argjson first "${LIMIT}" \
    '{
      query: $query,
      variables: {
        projectId: $projectId,
        userId: (if ($userId | length) > 0 then $userId else null end),
        first: $first
      }
    }' \
  | curl -sS "${API_URL}" \
      -H "X-Bloo-Token-ID: ${CLIENT_ID}" \
      -H "X-Bloo-Token-Secret: ${AUTH_TOKEN}" \
      -H "Content-Type: application/json" \
      --data @-
)"

if [[ "${RAW}" -eq 1 ]]; then
  echo "${response}" | jq .
  exit 0
fi

if echo "${response}" | jq -e '.errors? and (.errors | length > 0)' >/dev/null; then
  echo "${response}" | jq -r '.errors[] | "Error: \(.message)"' >&2
  exit 1
fi

total_count="$(echo "${response}" | jq -r '.data.activityList.totalCount // 0')"
activities_count="$(echo "${response}" | jq -r '.data.activityList.activities | length')"

echo "Blue activity feed"
echo "Workspace: ${PROJECT_ID}"
echo "Returned: ${activities_count}/${total_count}"
echo

echo "${response}" | jq -r '
  .data.activityList.activities[]
  | [
      .createdAt,
      (
        .createdBy.fullName
        // ((.createdBy.firstName // "") + (if .createdBy.lastName then " " + .createdBy.lastName else "" end))
        // .createdBy.email
        // "unknown"
      ),
      .category,
      (
        .todo.title
        // .comment.text
        // .html
        // ""
      )
    ]
  | @tsv
' | while IFS=$'\t' read -r created_at actor category details; do
  printf '%s | %s | %s\n' "${created_at}" "${actor}" "${category}"
  if [[ -n "${details}" ]]; then
    printf '  %s\n' "${details}"
  fi
  echo
done
