import enum
import secrets
import string
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, Enum as SQLEnum, DateTime, Text
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base

_SHORT_ID_ALPHABET = string.ascii_letters + string.digits  # a-zA-Z0-9 (62 chars)
_SHORT_ID_LENGTH = 8  # 62^8 ≈ 218 trillion combinations


def generate_short_id() -> str:
    """Generate a cryptographically random URL-safe short identifier."""
    return ''.join(secrets.choice(_SHORT_ID_ALPHABET) for _ in range(_SHORT_ID_LENGTH))


class ConversationStatus(str, enum.Enum):
    """Simplified conversation lifecycle states"""
    OPEN = "open"          # Active conversation, may or may not have agent assigned
    RESOLVED = "resolved"  # Conversation finished/closed


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    short_id = Column(String(16), unique=True, nullable=False, default=generate_short_id, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(String(255), nullable=False)
    status = Column(
        SQLEnum(ConversationStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ConversationStatus.OPEN
    )
    is_handoff = Column(Boolean, default=False)
    assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Optional website-team routing (website-scoped teams)
    team_id = Column(Integer, ForeignKey("website_teams.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # Inactivity tracking for auto-release
    last_agent_message_at = Column(DateTime, nullable=True)
    last_visitor_message_at = Column(DateTime, nullable=True)
    
    # Visitor metadata
    visitor_ip = Column(String(45), nullable=True)  # IPv4/IPv6 string
    visitor_name = Column(String(255), nullable=True)
    visitor_email = Column(String(255), nullable=True)
    visitor_phone = Column(String(50), nullable=True)
    device_info = Column(String(255), nullable=True)  # e.g., "Linux", "Windows 11"
    browser_info = Column(String(255), nullable=True)  # e.g., "Chrome 143.0.0.0"
    visit_count = Column(Integer, default=1, nullable=False)  # Number of visits by this visitor
    last_seen_at = Column(DateTime, nullable=True)  # When visitor was last active

    # UI: persisted avatar background color (hex), stable per visitor/session
    visitor_avatar_color = Column(String(16), nullable=True)

    # Read state for visitor
    visitor_last_read_at = Column(DateTime(timezone=True), nullable=True)

    # How the conversation was closed: 'agent' | 'visitor' | 'inactivity' | NULL (still open)
    closed_by = Column(String(20), nullable=True)

    # True when the visitor clicked "End chat". The conversation stays OPEN for
    # agents to follow up, but the visitor gets a fresh conversation on next connect.
    visitor_ended = Column(Boolean, nullable=False, default=False, server_default='false')

    # True for bot-only conversations (e.g. informational automation paths like Careers).
    # These conversations are never routed to a human agent: no push, no unread, no inbox
    # entry. They are auto-resolved after a configurable delay once the bot reply is sent.
    bot_only = Column(Boolean, nullable=False, default=False, server_default='false')

    website = relationship("Website", back_populates="conversations")
    team = relationship("WebsiteTeam")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True)
    tags = relationship("ConversationTag", back_populates="conversation", cascade="all, delete-orphan")
    notes = relationship("ConversationNote", cascade="all, delete-orphan", passive_deletes=True)
    reads = relationship("ConversationRead", cascade="all, delete-orphan", passive_deletes=True)
    page_views = relationship("ConversationPageView", cascade="all, delete-orphan", passive_deletes=True)
    assigned_agent = relationship("User", foreign_keys=[assigned_agent_id])
