#!/usr/bin/env bash
set -euo pipefail

# AI ChatAssist backup script
# - Dumps Postgres to /var/backups/aichatassist
# - Archives uploads directory
#
# Expected configuration:
# - /etc/aichatassist/backend.env (contains DATABASE_URL)
# - uploads stored at /var/lib/aichatassist/uploads (recommended)

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/aichatassist/backend.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/aichatassist}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/aichatassist/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (recommended via systemd)" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  echo "ERROR: backend env file not found: $BACKEND_ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$BACKEND_ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set in $BACKEND_ENV_FILE" >&2
  exit 1
fi

if [[ ! -d "$UPLOADS_DIR" ]]; then
  echo "ERROR: uploads directory not found: $UPLOADS_DIR" >&2
  exit 1
fi

now_utc="$(date -u +%Y%m%d-%H%M%S)"
out_dir="$BACKUP_ROOT/$now_utc"
mkdir -p "$out_dir"
chmod 700 "$out_dir"

# Parse DATABASE_URL safely using Python
read -r db_user db_password db_host db_port db_name < <(
  python3 - <<'PY'
import os
from urllib.parse import urlparse

u = urlparse(os.environ.get("DATABASE_URL", ""))
if not u.scheme or not u.path:
    raise SystemExit("Invalid DATABASE_URL")

user = u.username or ""
password = u.password or ""
host = u.hostname or "127.0.0.1"
port = str(u.port or 5432)
db = (u.path or "").lstrip("/")

print(user, password, host, port, db)
PY
)

if [[ -z "$db_user" || -z "$db_host" || -z "$db_port" || -z "$db_name" ]]; then
  echo "ERROR: failed to parse DATABASE_URL" >&2
  exit 1
fi

# Postgres dump (custom format is compressed and supports restores)
export PGPASSWORD="$db_password"

pg_dump \
  -h "$db_host" \
  -p "$db_port" \
  -U "$db_user" \
  -d "$db_name" \
  -F c \
  -f "$out_dir/postgres.dump"

unset PGPASSWORD

# Uploads archive
# Use numeric owner to avoid user/group mismatches when restoring.
tar --numeric-owner -czf "$out_dir/uploads.tar.gz" -C "$UPLOADS_DIR" .

# Metadata
{
  echo "timestamp_utc=$now_utc"
  echo "database_host=$db_host"
  echo "database_port=$db_port"
  echo "database_name=$db_name"
  echo "uploads_dir=$UPLOADS_DIR"
} > "$out_dir/metadata.txt"

# Rotate old backups
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print0 | xargs -0r rm -rf
fi

echo "OK: backup written to $out_dir"