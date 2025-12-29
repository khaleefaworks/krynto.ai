import enum
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, Enum as SQLEnum

from app.models.base import TimestampMixin
from app.core.database import Base


class ConversationStatus(str, enum.Enum):
    """Conversation lifecycle states"""
    ACTIVE = "active"      # Live agent chat in progress
    OFFLINE = "offline"    # Visitor left message while offline
    CLOSED = "closed"      # Conversation finished


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=False)
    session_id = Column(String(255), nullable=False)
    status = Column(
        SQLEnum(ConversationStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ConversationStatus.ACTIVE
    )
    is_handoff = Column(Boolean, default=False)
    assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
