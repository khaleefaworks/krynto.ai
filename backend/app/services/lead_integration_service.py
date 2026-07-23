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
from app.models.lead_integration_delivery import LeadDeliveryStatus
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
    form_id: int | None = None,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    extra_fields: dict | None = None,
    hold_for_confirmation: bool = True,
) -> None:
    """Record a captured lead and hold it for agent confirmation before it
    goes out to any webhook.

    form_id scopes delivery to integrations registered for that specific form
    (plus website-wide, unscoped integrations) — see
    integrations_repo.get_enabled_by_type. Leads with no form_id (the offline
    gate) only reach unscoped integrations.

    When conversation_id is set and hold_for_confirmation is True (the
    default, for automatic captures like the offline gate or a contact-card
    form), this is idempotent per (conversation, integration): a second call
    while a draft is still AWAITING_CONFIRMATION (visitor sending a
    corrected phone number, a second form on the same chat) folds into the
    same draft instead of creating a duplicate delivery — see
    deliveries_repo.merge_draft. The draft is only actually sent when an
    agent confirms it (see leads.py's confirm/discard endpoints) — there is
    no automatic timeout, by design: a held lead waits for a human.

    hold_for_confirmation=False (used by the agent-manual "send now" action,
    where a human already decided *right now* to send whatever's on the
    conversation) skips the hold and delivers immediately — same for leads
    with no conversation_id, which can't be reviewed in the agent UI anyway.

    Best-effort: never raises into the caller (offline-gate / form-submission
    paths must keep working even if a webhook is misconfigured or down).
    """
    try:
        integrations = integrations_repo.get_enabled_by_type(
            db, website_id, WebsiteIntegrationType.WEBHOOK, form_id=form_id
        )
        if not integrations:
            return

        for integration in integrations:
            existing = None
            if conversation_id is not None:
                existing = deliveries_repo.get_awaiting_confirmation(
                    db, conversation_id=conversation_id, integration_id=integration.id
                )

            if existing:
                # A draft is already waiting on this (conversation, integration) —
                # fold the new capture into it rather than creating a second
                # delivery, regardless of which path produced it.
                deliveries_repo.merge_draft(
                    db, existing, name=name, email=email, phone=phone, extra_fields=extra_fields
                )
                if hold_for_confirmation:
                    continue
                # hold_for_confirmation=False (agent hit "send now"): a human
                # just explicitly decided to send whatever's captured right
                # now, so resolve the existing draft immediately instead of
                # leaving it to linger and also queuing a second delivery.
                deliveries_repo.confirm_draft(db, existing)
                _schedule(_attempt_delivery(existing.id))
                continue

            if conversation_id is not None and hold_for_confirmation:
                deliveries_repo.create_awaiting_confirmation(
                    db,
                    website_id=website_id,
                    integration_id=integration.id,
                    source=source,
                    payload={
                        "event": "lead.captured",
                        "website_id": website_id,
                        "conversation_id": conversation_id,
                        "name": name,
                        "email": email,
                        "phone": phone,
                        "extra_fields": extra_fields or {},
                        "source": source,
                        "captured_at": datetime.utcnow().isoformat(),
                    },
                    conversation_id=conversation_id,
                )
                _schedule(_broadcast_lead_delivery_update(db, website_id=website_id, conversation_id=conversation_id))
                continue

            # No conversation to hold this against for review, or the caller
            # explicitly wants it sent now — deliver immediately.
            delivery = deliveries_repo.create_pending(
                db,
                website_id=website_id,
                integration_id=integration.id,
                source=source,
                payload={
                    "event": "lead.captured",
                    "website_id": website_id,
                    "conversation_id": conversation_id,
                    "name": name,
                    "email": email,
                    "phone": phone,
                    "extra_fields": extra_fields or {},
                    "source": source,
                    "captured_at": datetime.utcnow().isoformat(),
                },
                conversation_id=conversation_id,
            )
            _schedule(_attempt_delivery(delivery.id))
    except Exception as e:
        logger.error("lead_enqueue_failed", website_id=website_id, error=str(e))


def _schedule(coro) -> None:
    """Fire-and-forget a coroutine on the running loop; no-op outside one
    (e.g. sync test contexts) — the scheduled retry job picks up whatever
    this would have done shortly after."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        coro.close()


def collect_lead_form_submissions(db, conversation_id: int | None) -> dict:
    """Every form (with include_in_lead=True) this conversation has
    submitted, keyed by form name — not just whichever one originally
    triggered a given delivery. This is the live source of truth both for
    what an agent's still-AWAITING_CONFIRMATION review card shows and for
    what _enrich_payload_with_form_submissions freezes into the payload
    right before a send. Without this, a visitor who fills the contact card
    and then a second, unrelated form (e.g. "Virtual Office") would have the
    second form's answers stored but never surfaced to the agent or the
    webhook, since only is_contact_card forms call enqueue_lead.

    Forms with include_in_lead=False are skipped — an admin's explicit "keep
    this out of the CRM" call (internal surveys, anything privacy-sensitive),
    not something a per-conversation review step should override.

    is_contact_card forms are skipped too — their name/email/phone already
    ride along as the payload's top-level name/email/phone fields (any other
    field on that form is preserved separately via merge_draft's flat
    extra_fields), so including it here again would just duplicate the same
    three values a second time under a different key.
    """
    if not conversation_id:
        return {}
    from app.repos import forms as forms_repo

    submissions = forms_repo.get_submissions_by_conversation(db, conversation_id)
    form_data = {}
    for sub in submissions:
        if sub.form is not None and (not sub.form.include_in_lead or sub.form.is_contact_card):
            continue
        form_name = sub.form.name if sub.form else f"form_{sub.form_id}"
        form_data[form_name] = sub.data
    return form_data


def _enrich_payload_with_form_submissions(db, delivery) -> None:
    """Freeze collect_lead_form_submissions()'s current result into
    extra_fields.form_submissions, and refresh the top-level name/email/
    phone from the conversation's current visitor_* columns, right before
    the payload goes out. Runs on every attempt, not just the first, so
    anything filled in — or corrected — between retries still makes it into
    the eventual send.

    The name/email/phone refresh matters because those fields are frozen
    onto the payload once, at draft-creation/confirm time — unlike
    extra_fields.form_submissions, which was already always re-collected
    live. Editing the contact-card form (chats.py's form-submission PATCH)
    syncs conversation.visitor_*, but a delivery that's already SENT/FAILED
    isn't touched by that — without this refresh, a force-resend or a
    scheduled retry would silently keep pushing the stale name/email/phone
    captured at the original send, ignoring any correction made since.
    """
    payload = dict(delivery.payload or {})
    changed = False

    if delivery.conversation_id:
        from app.models.conversation import Conversation

        conversation = db.query(Conversation).filter_by(id=delivery.conversation_id).first()
        if conversation is not None:
            for field, value in (
                ("name", conversation.visitor_name),
                ("email", conversation.visitor_email),
                ("phone", conversation.visitor_phone),
            ):
                if value and payload.get(field) != value:
                    payload[field] = value
                    changed = True

    form_data = collect_lead_form_submissions(db, delivery.conversation_id)
    if form_data:
        extra = dict(payload.get("extra_fields") or {})
        extra["form_submissions"] = form_data
        payload["extra_fields"] = extra
        changed = True

    if not changed:
        return

    delivery.payload = payload
    db.commit()
    db.refresh(delivery)


def _enrich_payload_with_integration_metadata(db, integration, delivery) -> None:
    """Freeze the integration's admin-selected standard metadata fields
    (payload["metadata"]) and static custom key/value pairs
    (payload["custom_fields"]) right before send — same freeze-at-send-time
    pattern as _enrich_payload_with_form_submissions, so a field that
    changed since draft creation (agent reassigned, a tag added while the
    draft sat waiting for confirmation) reflects current state, and a retry
    after an admin edits the integration's field selection picks up the new
    selection too. Runs on every attempt, not just the first.

    custom_fields precedence: the integration's static config-level pairs
    are the base; any per-lead ad-hoc pairs an agent typed in at confirm
    time (already sitting in payload["custom_fields"] via
    deliveries_repo.merge_custom_fields) win on key collision, since a human
    just supplied a more specific value for this one lead.
    """
    config = integration.config or {}
    field_ids = config.get("metadata_fields") or []
    static_custom = config.get("custom_fields") or {}
    if not field_ids and not static_custom:
        return

    payload = dict(delivery.payload or {})
    changed = False

    if field_ids:
        from app.services.lead_metadata_fields import resolve_lead_metadata

        metadata = resolve_lead_metadata(db, conversation_id=delivery.conversation_id, field_ids=field_ids)
        if metadata and payload.get("metadata") != metadata:
            payload["metadata"] = metadata
            changed = True

    if static_custom:
        adhoc = dict(payload.get("custom_fields") or {})
        merged = {**static_custom, **adhoc}
        if merged != adhoc:
            payload["custom_fields"] = merged
            changed = True

    if not changed:
        return

    delivery.payload = payload
    db.commit()
    db.refresh(delivery)


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

        _enrich_payload_with_form_submissions(db, delivery)
        _enrich_payload_with_integration_metadata(db, integration, delivery)

        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, lambda: _push_webhook(integration.config, delivery.payload))
            deliveries_repo.mark_as_sent(db, delivery.id)
            await _fire_lead_delivered_trigger(delivery)
        except Exception as e:
            deliveries_repo.mark_as_failed_with_retry(
                db,
                delivery.id,
                attempt_count=delivery.attempt_count,
                error_message=str(e),
                retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
            )
            logger.warning("lead_delivery_attempt_failed", delivery_id=delivery.id, error=str(e))
        await _broadcast_lead_delivery_update(db, website_id=delivery.website_id, conversation_id=delivery.conversation_id)
    finally:
        db.close()


async def _fire_lead_delivered_trigger(delivery) -> None:
    """Notify the automations engine that a lead was successfully pushed out,
    so a website can wire lead_delivered -> tag_conversation (e.g. the same
    "leads created" tag agents already apply by hand once a lead lands in
    their CRM/ERP). Form-agnostic — fires the same way regardless of which
    form or integration produced the delivery, keyed only by conversation_id,
    so N forms need no special-casing here. Best-effort: never breaks delivery
    bookkeeping if the automations engine fails.
    """
    if not delivery.conversation_id:
        return
    db = SessionLocal()
    try:
        from app.services.conversation_orchestrator import ConversationOrchestrator

        orchestrator = ConversationOrchestrator(db)
        await orchestrator._run_automation_flows(
            conversation_id=delivery.conversation_id,
            website_id=delivery.website_id,
            trigger="lead_delivered",
            log_key="lead_delivered_automation_failed",
            send_to_visitor=False,
        )
    except Exception as e:
        logger.warning(
            "lead_delivered_trigger_failed",
            conversation_id=delivery.conversation_id,
            error=str(e),
        )
    finally:
        db.close()


def _fire_lead_delivered_trigger_sync(delivery) -> None:
    """Sync-context wrapper for the retry job, which APScheduler runs as a
    plain callable outside the event loop."""
    try:
        asyncio.run(_fire_lead_delivered_trigger(delivery))
    except Exception as e:
        logger.warning(
            "lead_delivered_trigger_failed",
            conversation_id=getattr(delivery, "conversation_id", None),
            error=str(e),
        )


async def _broadcast_lead_delivery_update(db, *, website_id: int, conversation_id: int | None) -> None:
    """Push a WS ping to agents watching this conversation whenever a
    delivery's status changes (sent or failed) — without this, the chat
    page's Lead delivery section and any tag an automation just applied only
    show up after a reload, since the status flip happens asynchronously
    after the agent's click (or on the background retry job) rather than in
    the request/response that triggered it. Best-effort, both outcomes.
    """
    if not conversation_id:
        return
    try:
        from app.services.agent_service import AgentService

        await AgentService(db).broadcast_to_active_agents(
            website_id=website_id,
            message_data={
                "type": "lead_delivery_updated",
                "conversation_id": conversation_id,
                "website_id": website_id,
            },
            include_global=True,
        )
    except Exception as e:
        logger.warning("lead_delivery_broadcast_failed", conversation_id=conversation_id, error=str(e))


def _broadcast_lead_delivery_update_sync(db, *, website_id: int, conversation_id: int | None) -> None:
    """Sync-context wrapper for the retry job (see _fire_lead_delivered_trigger_sync)."""
    try:
        asyncio.run(_broadcast_lead_delivery_update(db, website_id=website_id, conversation_id=conversation_id))
    except Exception as e:
        logger.warning("lead_delivery_broadcast_failed", conversation_id=conversation_id, error=str(e))


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


async def force_resend_delivery(db, delivery_id: int) -> dict:
    """Manually re-push one delivery right now, regardless of its current
    status or retry backoff schedule — backs the agent-facing "Resend"
    action. Raises ValueError if the delivery doesn't exist.
    """
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    delivery = db.query(LeadIntegrationDelivery).filter_by(id=delivery_id).first()
    if not delivery:
        raise ValueError("Delivery not found")

    await _attempt_delivery(delivery_id)
    db.refresh(delivery)
    return {
        "id": delivery.id,
        "status": delivery.status.value,
        "error_message": delivery.error_message,
        "attempt_count": delivery.attempt_count,
    }


async def send_confirmed_draft(
    db,
    delivery_id: int,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    custom_fields: dict[str, str] | None = None,
) -> dict:
    """Send a lead an agent just confirmed — applies any last-second edits,
    moves it from AWAITING_CONFIRMATION to PENDING, and delivers
    immediately. Raises ValueError if the delivery doesn't exist or isn't
    awaiting confirmation.

    Corrections to the *other* forms feeding this lead (Virtual Office,
    etc.) aren't applied here — the visitor-details panel saves those
    straight to their WebsiteFormSubmission rows via chats.py's
    form-submission PATCH before ever calling this, and
    _enrich_payload_with_form_submissions re-collects live from those rows
    on every send attempt, so a prior save is already reflected by the time
    this runs.
    """
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    delivery = db.query(LeadIntegrationDelivery).filter_by(id=delivery_id).first()
    if not delivery or delivery.status != LeadDeliveryStatus.AWAITING_CONFIRMATION:
        raise ValueError("Delivery not found or not awaiting confirmation")

    deliveries_repo.confirm_draft(db, delivery, name=name, email=email, phone=phone, custom_fields=custom_fields)
    await _attempt_delivery(delivery_id)
    db.refresh(delivery)
    return {
        "id": delivery.id,
        "status": delivery.status.value,
        "error_message": delivery.error_message,
        "attempt_count": delivery.attempt_count,
    }


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
                _broadcast_lead_delivery_update_sync(db, website_id=delivery.website_id, conversation_id=delivery.conversation_id)
                continue
            try:
                _enrich_payload_with_form_submissions(db, delivery)
                _enrich_payload_with_integration_metadata(db, integration, delivery)
                _push_webhook(integration.config, delivery.payload)
                deliveries_repo.mark_as_sent(db, delivery.id)
                _fire_lead_delivered_trigger_sync(delivery)
                succeeded += 1
            except Exception as e:
                deliveries_repo.mark_as_failed_with_retry(
                    db,
                    delivery.id,
                    attempt_count=delivery.attempt_count,
                    error_message=str(e),
                    retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
                )
            _broadcast_lead_delivery_update_sync(db, website_id=delivery.website_id, conversation_id=delivery.conversation_id)
        logger.info("lead_delivery_retry_job", attempted=attempted, succeeded=succeeded)
        return {"attempted": attempted, "succeeded": succeeded}
    finally:
        if should_close_db:
            db.close()
