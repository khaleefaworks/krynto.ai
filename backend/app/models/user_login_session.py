from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func

from app.models.base import TimestampMixin
from app.core.database import Base


class UserLoginSession(Base, TimestampMixin):
    """Tracks every issued JWT so sessions can be revoked server-side.

    jti (JWT ID) is a UUID embedded in every token at issuance.
    deps.py validates that the jti exists and is_active=True on every
    authenticated request.

    Backward compat: tokens issued before this feature was deployed carry
    no jti claim — they are accepted normally until they expire naturally.
    """
    __tablename__ = "user_login_sessions"

    id = Column(Integer, primary_key=True)
    jti = Column(String(36), nullable=False, unique=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ip_address = Column(String(45), nullable=True)   # IPv4 (15) or IPv4-mapped IPv6 (45)
    user_agent = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_used_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    revoked_at = Column(DateTime(timezone=True), nullable=True)
