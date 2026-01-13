from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.user import User


def touch_last_heartbeat_at(db: Session, *, user_id: int, now: datetime | None = None) -> None:
    if now is None:
        now = datetime.utcnow()
    (
        db.query(User)
        .filter(User.id == int(user_id))
        .update({"last_heartbeat_at": now}, synchronize_session=False)
    )


def recently_heartbeat_user_ids(db: Session, *, ttl_seconds: int, now: datetime | None = None) -> set[int]:
    if now is None:
        now = datetime.utcnow()
    cutoff = now - timedelta(seconds=int(ttl_seconds))
    rows = (
        db.query(User.id)
        .filter(User.last_heartbeat_at.is_not(None))
        .filter(User.last_heartbeat_at >= cutoff)
        .all()
    )
    return {int(r[0]) for r in rows}
