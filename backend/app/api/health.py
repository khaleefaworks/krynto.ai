from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

router = APIRouter()


@router.get("/health")
def health():
    # Backwards-compatible endpoint. For production probes prefer /health/live and /health/ready.
    return {"status": "ok"}


@router.get("/health/live")
def health_live():
    """Liveness probe.

    Should be fast and not depend on external services.
    """

    return {"status": "ok"}


@router.get("/health/ready")
async def health_ready():
    """Readiness probe.

    Verifies required dependencies are reachable:
    - Database is always required
    - Redis is required only when configured (REDIS_URL set)
    """

    # Database check
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HTTPException(status_code=503, detail={"status": "error", "dependency": "db", "error": str(e)})

    # Redis check (optional)
    redis_url = (getattr(settings, "REDIS_URL", "") or "").strip()
    if not redis_url:
        return {"status": "ok", "db": "ok", "redis": "disabled"}

    try:
        import redis.asyncio as redis_asyncio  # type: ignore

        client = redis_asyncio.from_url(redis_url, decode_responses=True)
        try:
            ok = await client.ping()
        finally:
            try:
                await client.aclose()
            except Exception:
                pass

        if not ok:
            raise HTTPException(status_code=503, detail={"status": "error", "dependency": "redis", "error": "ping_failed"})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail={"status": "error", "dependency": "redis", "error": str(e)})

    return {"status": "ok", "db": "ok", "redis": "ok"}
