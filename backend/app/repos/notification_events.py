"""
Repository for NotificationEvent queries.

Handles all database operations for notification tracking, retry queue, and deduplication.
"""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.notification_event import NotificationEvent, NotificationEventStatus, NotificationEventDeliveryMethod


def create(
    db: Session,
    *,
    conversation_id: int,
    agent_id: int,
    trigger_type: str,
    message_id: int | None = None,
    delivery_method: NotificationEventDeliveryMethod = NotificationEventDeliveryMethod.PUSH,
) -> NotificationEvent:
    """Create a new notification event record."""
    event = NotificationEvent(
        conversation_id=conversation_id,
        agent_id=agent_id,
        trigger_type=trigger_type,
        message_id=message_id,
        delivery_method=delivery_method,
        status=NotificationEventStatus.PENDING,
        attempt_count=0,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def update(
    db: Session,
    event_id: int,
    *,
    status: NotificationEventStatus | None = None,
    attempt_count: int | None = None,
    last_attempt_at: datetime | None = None,
    next_retry_at: datetime | None = None,
    error_message: str | None = None,
) -> NotificationEvent | None:
    """Update a notification event record."""
    event = db.query(NotificationEvent).filter(NotificationEvent.id == event_id).first()
    if not event:
        return None

    if status is not None:
        event.status = status
    if attempt_count is not None:
        event.attempt_count = attempt_count
    if last_attempt_at is not None:
        event.last_attempt_at = last_attempt_at
    if next_retry_at is not None:
        event.next_retry_at = next_retry_at
    if error_message is not None:
        event.error_message = error_message[:500]  # Truncate error messages

    event.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return event


def mark_as_sent(
    db: Session,
    event_id: int,
    error_message: str | None = None,
) -> NotificationEvent | None:
    """Mark event as sent (delivered to push service)."""
    return update(
        db,
        event_id,
        status=NotificationEventStatus.SENT,
        last_attempt_at=datetime.utcnow(),
        error_message=error_message,
    )


def mark_as_failed_with_retry(
    db: Session,
    event_id: int,
    attempt_count: int,
    error_message: str,
    retry_backoff_minutes: list[int] = None,
) -> NotificationEvent | None:
    """Mark event as failed and schedule retry with exponential backoff."""
    if retry_backoff_minutes is None:
        # Default backoff: 30s, 2m, 5m, 15m, 60m
        retry_backoff_minutes = [0.5, 2, 5, 15, 60]

    # If we've exceeded max retries, mark as failed permanently
    if attempt_count >= len(retry_backoff_minutes):
        return update(
            db,
            event_id,
            status=NotificationEventStatus.FAILED,
            last_attempt_at=datetime.utcnow(),
            error_message=error_message,
        )

    # Schedule next retry
    delay_minutes = retry_backoff_minutes[attempt_count] if attempt_count < len(retry_backoff_minutes) else 60
    next_retry = datetime.utcnow() + timedelta(minutes=delay_minutes)

    return update(
        db,
        event_id,
        status=NotificationEventStatus.PENDING,
        attempt_count=attempt_count + 1,
        last_attempt_at=datetime.utcnow(),
        next_retry_at=next_retry,
        error_message=error_message,
    )


def find_pending_retries(
    db: Session,
    limit: int = 100,
) -> list[NotificationEvent]:
    """Find notification events pending retry (due now or overdue)."""
    now = datetime.utcnow()
    return (
        db.query(NotificationEvent)
        .filter(
            NotificationEvent.status == NotificationEventStatus.PENDING,
            (NotificationEvent.next_retry_at.is_(None)) | (NotificationEvent.next_retry_at <= now),
        )
        .order_by(NotificationEvent.created_at.asc())
        .limit(limit)
        .all()
    )


def find_by_conversation_and_agent(
    db: Session,
    conversation_id: int,
    agent_id: int,
    limit: int = 10,
) -> list[NotificationEvent]:
    """Find all notifications for a conversation sent to an agent."""
    return (
        db.query(NotificationEvent)
        .filter(
            NotificationEvent.conversation_id == conversation_id,
            NotificationEvent.agent_id == agent_id,
        )
        .order_by(NotificationEvent.created_at.desc())
        .limit(limit)
        .all()
    )


def delete_old_completed(
    db: Session,
    older_than_days: int = 30,
) -> int:
    """Clean up old completed (sent/failed) notification events."""
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    count = (
        db.query(NotificationEvent)
        .filter(
            NotificationEvent.created_at < cutoff,
            NotificationEvent.status.in_([NotificationEventStatus.SENT, NotificationEventStatus.FAILED]),
        )
        .delete()
    )
    db.commit()
    return count


def get_by_id(db: Session, event_id: int) -> NotificationEvent | None:
    """Get a notification event by ID."""
    return db.query(NotificationEvent).filter(NotificationEvent.id == event_id).first()


def count_failed_for_agent(
    db: Session,
    agent_id: int,
    in_last_hours: int = 24,
) -> int:
    """Count failed notifications for an agent in the last N hours (for health monitoring)."""
    cutoff = datetime.utcnow() - timedelta(hours=in_last_hours)
    return (
        db.query(NotificationEvent)
        .filter(
            NotificationEvent.agent_id == agent_id,
            NotificationEvent.status == NotificationEventStatus.FAILED,
            NotificationEvent.created_at >= cutoff,
        )
        .count()
    )
