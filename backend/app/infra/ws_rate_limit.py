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


async def _ip_bucket_rate_limited(*, namespace: str, ip: str, max_per_minute: int, log_event: str) -> bool:
    """Shared per-minute bucket check for the IP-keyed limiters below.

    Same fail-open behavior as is_chat_rate_limited: no Redis
    configured/reachable means no decision (never blocks traffic on its own).
    """
    redis = await _get_redis()
    if redis is None:
        return False

    minute_bucket = int(time.time() // 60)
    key = f"aichatassist:{namespace}:rl:v1:{ip or 'unknown'}:{minute_bucket}"

    try:
        count = await redis.incr(key)
        if int(count) == 1:
            await redis.expire(key, 120)
        return int(count) > max_per_minute
    except Exception as e:
        logger.warning(log_event, error=str(e))
        return False


async def is_ws_connect_rate_limited(*, ip: str, limit: Optional[int] = None) -> bool:
    """Per-minute bucket limiter for WS connect attempts, keyed by client IP.

    A not-yet-connected visitor has no session to key on (and an attacker
    scripting connects can cycle session_id trivially), so IP is the right
    key here rather than session_id.
    """
    try:
        max_per_minute = int(limit if limit is not None else settings.RATE_LIMIT_WS_CONNECT)
    except Exception:
        max_per_minute = 30
    return await _ip_bucket_rate_limited(
        namespace="ws:connect", ip=ip, max_per_minute=max_per_minute,
        log_event="ws_connect_rate_limit_redis_failed",
    )


async def is_widget_read_rate_limited(*, ip: str, limit: Optional[int] = None) -> bool:
    """Per-minute bucket limiter for widget read/history REST endpoints, keyed by IP.

    Kept as a manual check (called from inside the route body, after CORS
    headers are set) rather than a slowapi @limiter.limit decorator: widget
    routes echo the visitor's own origin dynamically (arbitrary customer
    domains can't live in a static CORS allowlist), and slowapi's default
    429 handler runs before that echo — a rate-limited visitor would see a
    browser CORS failure instead of a clean 429.
    """
    try:
        max_per_minute = int(limit if limit is not None else settings.RATE_LIMIT_WIDGET_READ)
    except Exception:
        max_per_minute = 60
    return await _ip_bucket_rate_limited(
        namespace="widget:read", ip=ip, max_per_minute=max_per_minute,
        log_event="widget_read_rate_limit_redis_failed",
    )
