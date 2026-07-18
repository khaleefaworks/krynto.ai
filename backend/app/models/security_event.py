from sqlalchemy import Column, Integer, String, ForeignKey, JSON

from app.models.base import TimestampMixin
from app.core.database import Base


class SecurityEvent(Base, TimestampMixin):
    """Append-only security/activity audit log (event-based, not field-diffing).

    `metadata` is reserved by SQLAlchemy's declarative Base, so the JSON
    payload column/attribute is named `event_metadata` instead.
    """
    __tablename__ = "security_events"

    id = Column(Integer, primary_key=True)
    event_type = Column(String(50), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    ip_address = Column(String(45), nullable=True)
    event_metadata = Column(JSON, nullable=True)
