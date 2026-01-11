from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _limiter_storage_uri() -> str:
    redis_url = (getattr(settings, "REDIS_URL", "") or "").strip()
    if redis_url:
        return redis_url
    return "memory://"


# Global limiter instance shared across the app.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.RATE_LIMIT_DEFAULT],
    enabled=bool(settings.RATE_LIMIT_ENABLED),
    storage_uri=_limiter_storage_uri(),
)
