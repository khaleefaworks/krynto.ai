"""Push captured leads (offline gate + live-chat contact card) out to every
webhook a website has registered. WebsiteIntegration.type is generic — today
the only type is a plain outbound webhook, so a second type later is a new
value, not a schema change.

Both capture paths (ws_chat.py's visitor_contact handler, forms.py's
submit_form) call enqueue_lead() — the one choke point — so delivery,
retry, and signing logic lives in exactly one place.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

import requests as _requests

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.website_integration import WebsiteIntegrationType
from app.repos import website_integrations as integrations_repo
from app.repos import lead_integration_deliveries as deliveries_repo

logger = get_logger(__name__)

# Same schedule as notification_retry_service.py — 30s, 2m, 5m, 15m, 60m, then give up.
RETRY_BACKOFF_MINUTES = [0.5, 2, 5, 15, 60]

_REQUEST_TIMEOUT_SECONDS = 10


def enqueue_lead(
    db,
    *,
    website_id: int,
    source: str,
    conversation_id: int | None = None,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    extra_fields: dict | None = None,
) -> None:
    """Record a captured lead and kick off delivery to every enabled webhook.

    Best-effort: never raises into the caller (offline-gate / form-submission
    paths must keep working even if a webhook is misconfigured or down).
    """
    try:
        integrations = integrations_repo.get_enabled_by_type(
            db, website_id, WebsiteIntegrationType.WEBHOOK
        )
        if not integrations:
            return

        payload = {
            "event": "lead.captured",
            "website_id": website_id,
            "conversation_id": conversation_id,
            "name": name,
            "email": email,
            "phone": phone,
            "extra_fields": extra_fields or {},
            "source": source,
            "captured_at": datetime.utcnow().isoformat(),
        }

        for integration in integrations:
            # Guard against double-firing: the offline gate's visitor_contact
            # frame and its attached contact-card form submission can both
            # call enqueue_lead for the same overlay submit.
            if conversation_id is not None and deliveries_repo.exists_recent_for_conversation(
                db, conversation_id=conversation_id, integration_id=integration.id
            ):
                continue

            delivery = deliveries_repo.create_pending(
                db,
                website_id=website_id,
                integration_id=integration.id,
                source=source,
                payload=payload,
                conversation_id=conversation_id,
            )
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_attempt_delivery(delivery.id))
            except RuntimeError:
                # No running event loop (e.g. a sync test context) — the
                # scheduled retry job will pick this pending row up shortly.
                pass
    except Exception as e:
        logger.error("lead_enqueue_failed", website_id=website_id, error=str(e))


async def _attempt_delivery(delivery_id: int) -> None:
    """Push one pending delivery, in its own DB session (fire-and-forget task)."""
    db = SessionLocal()
    try:
        from app.models.lead_integration_delivery import LeadIntegrationDelivery

        delivery = db.query(LeadIntegrationDelivery).filter_by(id=delivery_id).first()
        if not delivery:
            return
        integration = integrations_repo.get_integration_by_id(db, delivery.integration_id)
        if not integration or not integration.enabled:
            return

        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, lambda: _push_webhook(integration.config, delivery.payload))
            deliveries_repo.mark_as_sent(db, delivery.id)
        except Exception as e:
            deliveries_repo.mark_as_failed_with_retry(
                db,
                delivery.id,
                attempt_count=delivery.attempt_count,
                error_message=str(e),
                retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
            )
            logger.warning("lead_delivery_attempt_failed", delivery_id=delivery.id, error=str(e))
    finally:
        db.close()


def _push_webhook(config: dict, payload: dict) -> None:
    """Synchronous POST to whatever URL the admin registered — run via
    run_in_executor, never on the event loop.

    The payload is sent as-is (no field-mapping/transform layer — that's the
    receiver's job, which is exactly what makes this generic instead of
    Frappe-specific). If a secret is configured, it rides along as a plain
    "secret" field in the JSON body rather than an HMAC-signed header —
    deliberately, since most no-code/sandboxed webhook receivers (Frappe
    Server Scripts, Zapier, n8n, Google Apps Script, ...) can read a JSON
    field and do a string comparison, but can't compute an HMAC signature
    (no hashlib/hmac access in most of those sandboxes). Over HTTPS this is
    the same trust model as a bearer API key, so it's no weaker in practice.

    Raises on any non-2xx response or network error; the caller schedules a retry.
    """
    url = str(config.get("url") or "").strip()
    if not url:
        raise ValueError("Webhook integration is missing a url")

    body = dict(payload)
    secret = config.get("secret")
    if secret:
        body["secret"] = secret

    response = _requests.post(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        timeout=_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()


def retry_failed_lead_deliveries(db=None, *, max_retries: int = 50) -> dict:
    """Retry pending lead deliveries due for another attempt.

    Registered on the app's existing AsyncIOScheduler (auto_close_scheduler.py)
    alongside the notification retry job — same reuse-the-scheduler reasoning
    already established there, no second scheduler stood up.
    """
    should_close_db = False
    if db is None:
        db = SessionLocal()
        should_close_db = True

    attempted = 0
    succeeded = 0
    try:
        pending = deliveries_repo.find_pending_retries(db, limit=max_retries)
        for delivery in pending:
            attempted += 1
            integration = integrations_repo.get_integration_by_id(db, delivery.integration_id)
            if not integration or not integration.enabled:
                deliveries_repo.mark_as_failed_with_retry(
                    db,
                    delivery.id,
                    attempt_count=len(RETRY_BACKOFF_MINUTES),
                    error_message="Integration disabled or deleted",
                    retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
                )
                continue
            try:
                _push_webhook(integration.config, delivery.payload)
                deliveries_repo.mark_as_sent(db, delivery.id)
                succeeded += 1
            except Exception as e:
                deliveries_repo.mark_as_failed_with_retry(
                    db,
                    delivery.id,
                    attempt_count=delivery.attempt_count,
                    error_message=str(e),
                    retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
                )
        logger.info("lead_delivery_retry_job", attempted=attempted, succeeded=succeeded)
        return {"attempted": attempted, "succeeded": succeeded}
    finally:
        if should_close_db:
            db.close()
