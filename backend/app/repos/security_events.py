"""Repository for the security/activity event log (AU3 Phase 1)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.security_event import SecurityEvent


def log_security_event(
    db: Session,
    *,
    event_type: str,
    actor_user_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    organization_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> Optional[SecurityEvent]:
    """Best-effort insert-only audit log write.

    Never raises — a logging failure must never block the primary flow
    (login, role change, etc.), matching the convention in
    `_record_login_session` (app/api/auth.py).
    """
    try:
        event = SecurityEvent(
            event_type=event_type,
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            organization_id=organization_id,
            ip_address=ip_address,
            event_metadata=metadata,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return event
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


def list_events(
    db: Session,
    *,
    organization_id: Optional[int] = None,
    event_type: Optional[str] = None,
    actor_user_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[SecurityEvent], int]:
    q = db.query(SecurityEvent)
    if organization_id is not None:
        q = q.filter(SecurityEvent.organization_id == organization_id)
    if event_type is not None:
        q = q.filter(SecurityEvent.event_type == event_type)
    if actor_user_id is not None:
        q = q.filter(SecurityEvent.actor_user_id == actor_user_id)
    if target_user_id is not None:
        q = q.filter(SecurityEvent.target_user_id == target_user_id)
    if date_from is not None:
        q = q.filter(SecurityEvent.created_at >= date_from)
    if date_to is not None:
        q = q.filter(SecurityEvent.created_at <= date_to)
    total = q.count()
    # created_at alone isn't a stable sort key: some DB backends (e.g.
    # SQLite's CURRENT_TIMESTAMP) only have 1-second resolution, so several
    # events logged within the same request burst can tie. `id` (monotonic,
    # autoincrement) breaks ties in true insertion order.
    rows = (
        q.order_by(SecurityEvent.created_at.desc(), SecurityEvent.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return rows, total
