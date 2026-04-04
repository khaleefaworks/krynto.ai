#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd -- "$BACKEND_DIR/.." && pwd)"

cd "$BACKEND_DIR"
export PYTHONPATH="$BACKEND_DIR"

if [[ -n "${VIRTUAL_ENV:-}" && -x "${VIRTUAL_ENV}/bin/python" ]]; then
	VENV_BIN="${VIRTUAL_ENV}/bin"
elif [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
	VENV_BIN="$BACKEND_DIR/.venv/bin"
elif [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
	VENV_BIN="$REPO_ROOT/.venv/bin"
else
	echo "ERROR: No virtual environment found." >&2
	echo "Expected one of:" >&2
	echo "  - active virtualenv via VIRTUAL_ENV" >&2
	echo "  - $BACKEND_DIR/.venv" >&2
	echo "  - $REPO_ROOT/.venv" >&2
	echo "Create the preferred backend-local venv with:" >&2
	echo "  cd $BACKEND_DIR && python3 -m venv .venv" >&2
	exit 1
fi

VENV_PY="$VENV_BIN/python"
VENV_UVICORN="$VENV_BIN/uvicorn"
VENV_ALEMBIC="$VENV_BIN/alembic"

if [[ ! -x "$VENV_UVICORN" ]]; then
	echo "ERROR: Missing uvicorn at $VENV_UVICORN" >&2
	echo "Install deps: $VENV_PY -m pip install -r $BACKEND_DIR/requirements.txt" >&2
	echo "Or use the locked set: $VENV_PY -m pip install -r $BACKEND_DIR/requirements.lock.txt" >&2
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
