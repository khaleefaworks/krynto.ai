import shlex
from typing import Mapping


def detect_configured_worker_count(environ: Mapping[str, str] | None = None) -> int | None:
    """Best-effort detection of a configured worker count.

    This is meant for guardrails/logging only. In many deployments the true worker
    count is not directly observable from inside a worker process.
    """

    env = environ or {}

    for key in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        raw = (env.get(key) or "").strip()
        if not raw:
            continue
        try:
            value = int(raw)
        except ValueError:
            continue
        if value > 0:
            return value

    cmd = (env.get("GUNICORN_CMD_ARGS") or "").strip()
    if not cmd:
        return None

    try:
        parts = shlex.split(cmd)
    except ValueError:
        parts = cmd.split()

    for i, part in enumerate(parts):
        if part in ("-w", "--workers"):
            if i + 1 < len(parts):
                try:
                    value = int(parts[i + 1])
                except ValueError:
                    continue
                if value > 0:
                    return value
        if part.startswith("--workers="):
            raw = part.split("=", 1)[1].strip()
            try:
                value = int(raw)
            except ValueError:
                continue
            if value > 0:
                return value
        if part.startswith("-w") and len(part) > 2:
            raw = part[2:].strip()
            try:
                value = int(raw)
            except ValueError:
                continue
            if value > 0:
                return value

    return None
