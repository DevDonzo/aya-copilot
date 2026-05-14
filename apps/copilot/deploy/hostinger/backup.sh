#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${AYA_DATA_ROOT:-/srv/aya}"
BACKUP_ROOT="${AYA_BACKUP_ROOT:-/srv/aya/backups}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBRECHAT_ENV="${DEPLOY_DIR}/env/librechat.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"

mkdir -p "${DEST}"

archive_path() {
  local path="$1"
  local output="$2"

  if [[ -e "${DATA_ROOT}/${path}" ]]; then
    tar -C "${DATA_ROOT}" -czf "${DEST}/${output}" "${path}"
  fi
}

archive_path aya aya-sqlite.tar.gz
archive_path librechat/uploads librechat-uploads.tar.gz
archive_path librechat/logs librechat-logs.tar.gz

if docker ps --format '{{.Names}}' | grep -qx 'aya-chat-mongodb'; then
  mongo_uri=""
  if [[ -f "${LIBRECHAT_ENV}" ]]; then
    mongo_uri="$(grep -E '^MONGO_URI=' "${LIBRECHAT_ENV}" | tail -1 | cut -d= -f2- || true)"
  fi

  if [[ -n "${mongo_uri}" && "${mongo_uri}" != *"replace-with-mongo-password"* ]]; then
    dump_uri="${mongo_uri//@mongodb:27017/@127.0.0.1:27017}"
    docker exec -e MONGO_URI="${dump_uri}" aya-chat-mongodb \
      sh -lc 'mongodump --uri "$MONGO_URI" --archive --gzip' \
      > "${DEST}/librechat-mongodb.archive.gz"
  else
    docker exec aya-chat-mongodb mongodump --archive --gzip > "${DEST}/librechat-mongodb.archive.gz"
  fi
else
  archive_path mongodb librechat-mongodb-files.tar.gz
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${DEST}" && sha256sum ./*.gz > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "${DEST}" && shasum -a 256 ./*.gz > SHA256SUMS)
fi

echo "Backup written to ${DEST}"
