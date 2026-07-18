"""Repository for LeadIntegrationDelivery — mirrors app/repos/notification_events.py's
retry-queue shape, scoped to outbound lead pushes instead of push notifications."""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.models.lead_integration_delivery import LeadIntegrationDelivery, LeadDeliveryStatus


def exists_recent_for_conversation(
    db: Session, *, conversation_id: int, integration_id: int, within_seconds: int = 30
) -> bool:
    """True if a delivery for this (conversation, integration) was already
    created very recently — guards against the offline gate's visitor_contact
    frame and its attached contact-card form submission both enqueueing the
    same capture (they can both fire for the same overlay submit)."""
    cutoff = datetime.utcnow() - timedelta(seconds=within_seconds)
    return (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.conversation_id == conversation_id,
            LeadIntegrationDelivery.integration_id == integration_id,
            LeadIntegrationDelivery.created_at >= cutoff,
        )
        .first()
        is not None
    )


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
