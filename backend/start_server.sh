#!/bin/bash
set -euo pipefail

cd /home/frappe/Applications/ai-chatassist/backend
export PYTHONPATH=/home/frappe/Applications/ai-chatassist/backend

VENV_PY="/home/frappe/Applications/ai-chatassist/.venv/bin/python"
VENV_UVICORN="/home/frappe/Applications/ai-chatassist/.venv/bin/uvicorn"
VENV_ALEMBIC="/home/frappe/Applications/ai-chatassist/.venv/bin/alembic"

if [[ ! -x "$VENV_PY" ]]; then
	echo "ERROR: Missing python at $VENV_PY" >&2
	echo "Create the venv at repo root: cd /home/frappe/Applications/ai-chatassist && python -m venv .venv" >&2
	exit 1
fi

if [[ ! -x "$VENV_UVICORN" ]]; then
	echo "ERROR: Missing uvicorn at $VENV_UVICORN" >&2
	echo "Install deps: $VENV_PY -m pip install -r /home/frappe/Applications/ai-chatassist/backend/requirements.txt" >&2
	exit 1
fi

# Preflight: ensure DATABASE_URL is configured and DB is reachable.
# Skip with: SKIP_DB_CHECK=1 ./start_server.sh
if [[ "${SKIP_DB_CHECK:-0}" != "1" ]]; then
	echo "Checking database connectivity..." >&2
	"$VENV_PY" - <<'PY'
from __future__ import annotations

import sys

from sqlalchemy import create_engine, text

try:
	from app.core.config import settings
except Exception as e:  # pragma: no cover
	print(f"ERROR: Failed to load settings (.env). {e}", file=sys.stderr)
	sys.exit(2)

database_url = (getattr(settings, "DATABASE_URL", "") or "").strip()
if not database_url:
	print("ERROR: DATABASE_URL is not set (backend/.env)", file=sys.stderr)
	sys.exit(2)

engine = create_engine(database_url, pool_pre_ping=True)
try:
	with engine.connect() as conn:
		conn.execute(text("SELECT 1"))
except Exception as e:
	print("ERROR: Database connection failed.", file=sys.stderr)
	print(f"DATABASE_URL={database_url}", file=sys.stderr)
	print(str(e), file=sys.stderr)
	sys.exit(3)

print("Database OK", file=sys.stderr)
PY
fi

# Optional: apply DB migrations before starting.
# Enable with: RUN_MIGRATIONS=1 ./start_server.sh
if [[ "${RUN_MIGRATIONS:-0}" == "1" ]]; then
	"$VENV_ALEMBIC" upgrade head
fi

exec "$VENV_UVICORN" app.main:app --host 0.0.0.0 --port 8000 --reload
