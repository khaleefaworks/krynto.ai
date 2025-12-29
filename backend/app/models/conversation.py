import enum
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, Enum as SQLEnum

from app.models.base import TimestampMixin
from app.core.database import Base


class ConversationStatus(str, enum.Enum):
    """Conversation lifecycle states"""
    ACTIVE = "active"      # Live agent chat in progress
    OFFLINE = "offline"    # Visitor left message while offline
    CLOSED = "closed"      # Conversation finished


class ConversationMode(str, enum.Enum):
    """Who is handling the conversation right now"""
    AI_HANDLING = "ai_handling"              # AI is responding
    WAITING_FOR_AGENT = "waiting_for_agent"  # Needs agent to claim
    AGENT_HANDLING = "agent_handling"        # Agent has claimed


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
    mode = Column(
        SQLEnum(ConversationMode, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ConversationMode.AI_HANDLING
    )
    is_handoff = Column(Boolean, default=False)
    assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
