from __future__ import annotations

import time
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _import_redis_asyncio():
    try:
        import redis.asyncio as redis_asyncio  # type: ignore

        return redis_asyncio
    except Exception:
        return None


_redis_client = None


async def _get_redis():
    global _redis_client

    redis_url = (getattr(settings, "REDIS_URL", "") or "").strip()
    if not redis_url:
        return None

    redis_asyncio = _import_redis_asyncio()
    if redis_asyncio is None:
        return None

    if _redis_client is None:
        _redis_client = redis_asyncio.from_url(redis_url, decode_responses=True)

    return _redis_client


async def is_chat_rate_limited(*, website_id: int, session_id: str, limit: Optional[int] = None) -> bool:
    """Sliding-ish window limiter using Redis per-minute bucket.

    - Uses Redis only when REDIS_URL is set.
    - Falls back to False (no decision) if Redis isn't available.

    This is intentionally simple and multi-worker safe.
    """
    redis = await _get_redis()
    if redis is None:
        return False

    try:
        max_per_minute = int(limit if limit is not None else settings.RATE_LIMIT_CHAT_MESSAGE)
    except Exception:
        max_per_minute = 10

    # Per-minute bucket key.
    minute_bucket = int(time.time() // 60)
    key = f"aichatassist:ws:chat:rl:v1:{website_id}:{session_id}:{minute_bucket}"

    try:
        count = await redis.incr(key)
        if int(count) == 1:
            # Expire after ~2 minutes to cover clock skew and avoid lingering keys.
            await redis.expire(key, 120)
        return int(count) > max_per_minute
    except Exception as e:
        logger.warning("ws_rate_limit_redis_failed", error=str(e))
        return False
