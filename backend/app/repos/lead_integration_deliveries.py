"""Repository for LeadIntegrationDelivery — mirrors app/repos/notification_events.py's
retry-queue shape, scoped to outbound lead pushes instead of push notifications."""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.models.lead_integration_delivery import LeadIntegrationDelivery, LeadDeliveryStatus


def create_pending(
    db: Session,
    *,
    website_id: int,
    integration_id: int,
    source: str,
    payload: dict,
    conversation_id: int | None = None,
) -> LeadIntegrationDelivery:
    delivery = LeadIntegrationDelivery(
        website_id=website_id,
        conversation_id=conversation_id,
        integration_id=integration_id,
        source=source,
        payload=payload,
        status=LeadDeliveryStatus.PENDING,
        attempt_count=0,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def create_awaiting_confirmation(
    db: Session,
    *,
    website_id: int,
    integration_id: int,
    source: str,
    payload: dict,
    conversation_id: int,
) -> LeadIntegrationDelivery:
    """A newly-captured lead held for agent review instead of sent right
    away — see get_awaiting_confirmation/merge_draft for how later captures
    (visitor corrections, a second form) fold into this same row rather than
    creating duplicate deliveries."""
    delivery = LeadIntegrationDelivery(
        website_id=website_id,
        conversation_id=conversation_id,
        integration_id=integration_id,
        source=source,
        payload=payload,
        status=LeadDeliveryStatus.AWAITING_CONFIRMATION,
        attempt_count=0,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def get_awaiting_confirmation(
    db: Session, *, conversation_id: int, integration_id: int
) -> LeadIntegrationDelivery | None:
    return (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.conversation_id == conversation_id,
            LeadIntegrationDelivery.integration_id == integration_id,
            LeadIntegrationDelivery.status == LeadDeliveryStatus.AWAITING_CONFIRMATION,
        )
        .first()
    )


def merge_draft(
    db: Session,
    delivery: LeadIntegrationDelivery,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    extra_fields: dict | None = None,
) -> LeadIntegrationDelivery:
    """Fold a new capture (a visitor's correction, or a second form) into an
    already-AWAITING_CONFIRMATION draft in place, instead of creating a
    second delivery. Reassigns `payload` to a new dict (rather than mutating
    it) so SQLAlchemy detects the JSON column change."""
    payload = dict(delivery.payload or {})
    if name:
        payload["name"] = name
    if email:
        payload["email"] = email
    if phone:
        payload["phone"] = phone
    if extra_fields:
        merged_extra = dict(payload.get("extra_fields") or {})
        merged_extra.update(extra_fields)
        payload["extra_fields"] = merged_extra
    delivery.payload = payload
    db.commit()
    db.refresh(delivery)
    return delivery


def merge_custom_fields(
    db: Session,
    delivery: LeadIntegrationDelivery,
    *,
    custom_fields: dict[str, str],
) -> LeadIntegrationDelivery:
    """Fold agent-typed one-off key/value pairs (learned verbally, not from
    any form field) into payload["custom_fields"] on this one delivery —
    never touches the integration's own config, so it doesn't affect any
    other lead sent through the same webhook. Same reassign-the-whole-dict
    pattern as merge_draft, so SQLAlchemy detects the JSON column change."""
    if not custom_fields:
        return delivery
    payload = dict(delivery.payload or {})
    merged = dict(payload.get("custom_fields") or {})
    merged.update({k: v for k, v in custom_fields.items() if k})
    payload["custom_fields"] = merged
    delivery.payload = payload
    db.commit()
    db.refresh(delivery)
    return delivery


def confirm_draft(
    db: Session,
    delivery: LeadIntegrationDelivery,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    custom_fields: dict[str, str] | None = None,
) -> LeadIntegrationDelivery:
    """Move an AWAITING_CONFIRMATION draft to PENDING so the normal delivery
    path picks it up — optionally applying last-second edits (the agent
    fixing a typo before sending) first."""
    if name or email or phone:
        merge_draft(db, delivery, name=name, email=email, phone=phone)
    if custom_fields:
        merge_custom_fields(db, delivery, custom_fields=custom_fields)
    delivery.status = LeadDeliveryStatus.PENDING
    db.commit()
    db.refresh(delivery)
    return delivery


def discard_draft(db: Session, delivery: LeadIntegrationDelivery) -> LeadIntegrationDelivery:
    delivery.status = LeadDeliveryStatus.CANCELLED
    db.commit()
    db.refresh(delivery)
    return delivery


def mark_as_sent(db: Session, delivery_id: int) -> LeadIntegrationDelivery | None:
    delivery = db.query(LeadIntegrationDelivery).filter(LeadIntegrationDelivery.id == delivery_id).first()
    if not delivery:
        return None
    delivery.status = LeadDeliveryStatus.SENT
    delivery.last_attempt_at = datetime.utcnow()
    db.commit()
    db.refresh(delivery)
    return delivery


def mark_as_failed_with_retry(
    db: Session,
    delivery_id: int,
    *,
    attempt_count: int,
    error_message: str,
    retry_backoff_minutes: list[float] | None = None,
) -> LeadIntegrationDelivery | None:
    if retry_backoff_minutes is None:
        retry_backoff_minutes = [0.5, 2, 5, 15, 60]

    delivery = db.query(LeadIntegrationDelivery).filter(LeadIntegrationDelivery.id == delivery_id).first()
    if not delivery:
        return None

    delivery.last_attempt_at = datetime.utcnow()
    delivery.error_message = error_message[:500]

    if attempt_count >= len(retry_backoff_minutes):
        delivery.status = LeadDeliveryStatus.FAILED
        delivery.attempt_count = attempt_count
    else:
        delivery.status = LeadDeliveryStatus.PENDING
        delivery.attempt_count = attempt_count + 1
        delivery.next_retry_at = datetime.utcnow() + timedelta(minutes=retry_backoff_minutes[attempt_count])

    db.commit()
    db.refresh(delivery)
    return delivery


def find_pending_retries(db: Session, limit: int = 100) -> list[LeadIntegrationDelivery]:
    now = datetime.utcnow()
    return (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.status == LeadDeliveryStatus.PENDING,
            (LeadIntegrationDelivery.next_retry_at.is_(None)) | (LeadIntegrationDelivery.next_retry_at <= now),
        )
        .order_by(LeadIntegrationDelivery.created_at.asc())
        .limit(limit)
        .all()
    )
