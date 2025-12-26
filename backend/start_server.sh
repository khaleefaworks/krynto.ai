#!/bin/bash
cd /home/frappe/Applications/ai-chatassist/backend
export PYTHONPATH=/home/frappe/Applications/ai-chatassist/backend
exec /home/frappe/Applications/ai-chatassist/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
