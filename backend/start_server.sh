#!/bin/bash
set -euo pipefail

cd /home/frappe/Applications/ai-chatassist/backend
export PYTHONPATH=/home/frappe/Applications/ai-chatassist/backend

# Optional: apply DB migrations before starting.
# Enable with: RUN_MIGRATIONS=1 ./start_server.sh
if [[ "${RUN_MIGRATIONS:-0}" == "1" ]]; then
	/home/frappe/Applications/ai-chatassist/.venv/bin/alembic upgrade head
fi

exec /home/frappe/Applications/ai-chatassist/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
