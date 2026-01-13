import json
from typing import Iterable

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models.push_subscription import PushSubscription

logger = get_logger(__name__)


def _vapid_ready() -> bool:
    return bool((settings.VAPID_PUBLIC_KEY or "").strip() and (settings.VAPID_PRIVATE_KEY or "").strip() and (settings.VAPID_SUBJECT or "").strip())


def send_web_push_to_subscriptions(
    *,
    subscriptions: Iterable[PushSubscription],
    title: str,
    body: str | None = None,
    url: str | None = None,
) -> int:
    """Send Web Push notifications.

    Returns count of attempted sends (best-effort).
    """

    if not _vapid_ready():
        logger.info("web_push_disabled_missing_vapid")
        return 0

    try:
        from pywebpush import webpush  # type: ignore
    except Exception:
        logger.warning("web_push_pywebpush_unavailable")
        return 0

    payload = {
        "title": str(title),
        "body": str(body) if body else "",
        "url": str(url) if url else "",
    }

    count = 0

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth": sub.auth,
                    },
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
            count += 1
        except Exception as e:
            logger.warning(
                "web_push_send_failed",
                agent_id=sub.agent_id,
                error=str(e),
            )

    return count
