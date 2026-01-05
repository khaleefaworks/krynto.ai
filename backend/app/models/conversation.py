import enum
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, Enum as SQLEnum, DateTime, Text

from app.models.base import TimestampMixin
from app.core.database import Base


class ConversationStatus(str, enum.Enum):
    """Simplified conversation lifecycle states"""
    OPEN = "open"          # Active conversation, may or may not have agent assigned
    RESOLVED = "resolved"  # Conversation finished/closed


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=False)
    session_id = Column(String(255), nullable=False)
    status = Column(
        SQLEnum(ConversationStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ConversationStatus.OPEN
    )
    is_handoff = Column(Boolean, default=False)
    assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Inactivity tracking for auto-release
    last_agent_message_at = Column(DateTime, nullable=True)
    last_visitor_message_at = Column(DateTime, nullable=True)
    
    # Visitor metadata
    visitor_name = Column(String(255), nullable=True)
    visitor_email = Column(String(255), nullable=True)
    visitor_phone = Column(String(50), nullable=True)
    device_info = Column(String(255), nullable=True)  # e.g., "Linux", "Windows 11"
    browser_info = Column(String(255), nullable=True)  # e.g., "Chrome 143.0.0.0"
    visit_count = Column(Integer, default=1, nullable=False)  # Number of visits by this visitor
    last_seen_at = Column(DateTime, nullable=True)  # When visitor was last active
