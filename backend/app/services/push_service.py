import json
import threading
from typing import Iterable

import requests as _requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models.push_subscription import PushSubscription

logger = get_logger(__name__)

# Module-level requests.Session shared across all push calls.
# Keeps the TCP+TLS connection to the push endpoint alive between calls,
# eliminating the ~200-400ms handshake overhead on every notification.
_session_lock = threading.Lock()
_push_session: _requests.Session | None = None


def _get_push_session() -> _requests.Session:
    global _push_session
    if _push_session is None:
        with _session_lock:
            if _push_session is None:
                s = _requests.Session()
                # Allow up to 4 persistent connections to push endpoints.
                adapter = _requests.adapters.HTTPAdapter(
                    pool_connections=4,
                    pool_maxsize=4,
                    max_retries=0,
                )
                s.mount("https://", adapter)
                _push_session = s
    return _push_session


def _vapid_ready() -> bool:
    return bool((settings.VAPID_PUBLIC_KEY or "").strip() and (settings.VAPID_PRIVATE_KEY or "").strip() and (settings.VAPID_SUBJECT or "").strip())


def send_web_push_to_subscriptions(
    *,
    subscriptions: Iterable[PushSubscription],
    title: str,
    body: str | None = None,
    url: str | None = None,
    push_type: str | None = None,   # "new_chat" | "new_message" | None
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
        "push_type": str(push_type) if push_type else "new_message",
    }

    count = 0
    stale_sub_ids: list[tuple[int, str]] = []  # (agent_id, endpoint)
    push_session = _get_push_session()

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
                requests_session=push_session,
            )
            count += 1
        except Exception as e:
            err_str = str(e)
            # HTTP 410 Gone — push endpoint is no longer valid (browser unsubscribed,
            # different device, or stale dev session). Remove it so it doesn't accumulate.
            is_gone = "410" in err_str or (
                hasattr(e, "response")
                and getattr(getattr(e, "response", None), "status_code", None) == 410
            )
            if is_gone:
                stale_sub_ids.append((sub.agent_id, sub.endpoint))
            logger.warning(
                "web_push_send_failed",
                agent_id=sub.agent_id,
                status_gone=is_gone,
                error=err_str[:200],
            )

    # Prune stale subscriptions in a dedicated session (safe to call from thread executor).
    if stale_sub_ids:
        try:
            from app.core.database import SessionLocal
            from app.repos import push_subscriptions as push_subs_repo

            db = SessionLocal()
            try:
                for agent_id, endpoint in stale_sub_ids:
                    push_subs_repo.delete_subscription(db, agent_id=agent_id, endpoint=endpoint)
            finally:
                db.close()
        except Exception as cleanup_err:
            logger.warning("push_stale_cleanup_failed", error=str(cleanup_err))

    return count
