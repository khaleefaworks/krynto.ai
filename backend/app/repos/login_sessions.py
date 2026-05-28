"""Repository for user login sessions (JWT jti tracking + revocation)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.user_login_session import UserLoginSession


def create_session(
    db: Session,
    *,
    jti: str,
    user_id: int,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> UserLoginSession:
    session = UserLoginSession(
        jti=jti,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        is_active=True,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_by_jti(db: Session, jti: str) -> Optional[UserLoginSession]:
    return db.query(UserLoginSession).filter_by(jti=jti).first()


def touch_last_used(db: Session, jti: str) -> None:
    """Update last_used_at timestamp; best-effort (no error if row missing)."""
    db.query(UserLoginSession).filter_by(jti=jti, is_active=True).update(
        {"last_used_at": datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    db.commit()


def revoke_session(db: Session, jti: str) -> bool:
    """Revoke a single session by jti. Returns True if a row was found and revoked."""
    now = datetime.now(timezone.utc)
    updated = (
        db.query(UserLoginSession)
        .filter_by(jti=jti, is_active=True)
        .update(
            {"is_active": False, "revoked_at": now},
            synchronize_session=False,
        )
    )
    db.commit()
    return updated > 0


def revoke_all_for_user(db: Session, user_id: int) -> int:
    """Revoke every active session for a user. Returns the count revoked."""
    now = datetime.now(timezone.utc)
    updated = (
        db.query(UserLoginSession)
        .filter_by(user_id=user_id, is_active=True)
        .update(
            {"is_active": False, "revoked_at": now},
            synchronize_session=False,
        )
    )
    db.commit()
    return updated


def list_active_for_user(db: Session, user_id: int) -> list[UserLoginSession]:
    return (
        db.query(UserLoginSession)
        .filter_by(user_id=user_id, is_active=True)
        .order_by(UserLoginSession.created_at.desc())
        .all()
    )
