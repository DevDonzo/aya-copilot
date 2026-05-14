#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBRECHAT_ENV="${DEPLOY_DIR}/env/librechat.env"
AYA_ENV="${DEPLOY_DIR}/env/aya.env"
MONGO_CONTAINER="${MONGO_CONTAINER:-aya-chat-mongodb}"

if [[ ! -f "${LIBRECHAT_ENV}" || ! -f "${AYA_ENV}" ]]; then
  echo "Missing env/librechat.env or env/aya.env. Copy the example env files first." >&2
  exit 1
fi

existing_username="$(grep -E '^MONGO_INITDB_ROOT_USERNAME=' "${LIBRECHAT_ENV}" | tail -1 | cut -d= -f2- || true)"
MONGO_USERNAME="${MONGO_INITDB_ROOT_USERNAME:-${existing_username:-aya_mongo_root}}"
existing_password="$(grep -E '^MONGO_INITDB_ROOT_PASSWORD=' "${LIBRECHAT_ENV}" | tail -1 | cut -d= -f2- || true)"
if [[ -z "${existing_password}" || "${existing_password}" == "replace-with-mongo-password" ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required to generate a Mongo password." >&2
    exit 1
  fi
  MONGO_PASSWORD="$(openssl rand -hex 32)"
else
  MONGO_PASSWORD="${existing_password}"
fi

MONGO_URI="mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@mongodb:27017/LibreChat?authSource=admin"

set_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { written = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      written = 1
      next
    }
    { print }
    END {
      if (written == 0) {
        print key "=" value
      }
    }
  ' "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

set_env_var "${LIBRECHAT_ENV}" "MONGO_INITDB_ROOT_USERNAME" "${MONGO_USERNAME}"
set_env_var "${LIBRECHAT_ENV}" "MONGO_INITDB_ROOT_PASSWORD" "${MONGO_PASSWORD}"
set_env_var "${LIBRECHAT_ENV}" "MONGO_URI" "${MONGO_URI}"
set_env_var "${AYA_ENV}" "LIBRECHAT_MONGO_URI" "${MONGO_URI}"

if ! docker ps --format '{{.Names}}' | grep -qx "${MONGO_CONTAINER}"; then
  echo "Mongo container ${MONGO_CONTAINER} is not running."
  echo "The env files were updated. Start the old no-auth Mongo once, run this script again, then restart with auth."
  exit 1
fi

create_user_js="
const existing = db.getSiblingDB('admin').getUser('${MONGO_USERNAME}');
if (!existing) {
  db.getSiblingDB('admin').createUser({
    user: '${MONGO_USERNAME}',
    pwd: '${MONGO_PASSWORD}',
    roles: [{ role: 'root', db: 'admin' }]
  });
  print('created');
} else {
  print('exists');
}
"

if docker exec "${MONGO_CONTAINER}" mongosh admin --quiet --eval "${create_user_js}" >/dev/null; then
  echo "Mongo admin user is ready. Restart the stack with docker compose up -d --build."
  exit 0
fi

if docker exec "${MONGO_CONTAINER}" mongosh admin \
  -u "${MONGO_USERNAME}" \
  -p "${MONGO_PASSWORD}" \
  --authenticationDatabase admin \
  --quiet \
  --eval 'db.runCommand({ connectionStatus: 1 }).ok' >/dev/null; then
  echo "Mongo auth is already enabled and the configured password works."
  exit 0
fi

echo "Could not create or verify the Mongo admin user. Check the Mongo container logs before enabling auth." >&2
exit 1
