import enum
from sqlalchemy import Boolean, Column, Integer, ForeignKey, Text, String, Enum as SQLEnum
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class MessageSenderType(str, enum.Enum):
    """Message sender types"""
    VISITOR = "visitor"    # Customer/visitor message
    AGENT = "agent"        # Agent/user message
    SYSTEM = "system"      # System-generated message


class Message(Base, TimestampMixin):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_type = Column(
        SQLEnum(MessageSenderType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MessageSenderType.VISITOR
    )
    sender = Column(String(50))  # Kept for backward compatibility (email/name)
    # Additional subtype for SYSTEM messages (e.g. automation_welcome, agent_join)
    event_type = Column(String(50), nullable=True)
    content = Column(Text, nullable=False)
    # True when the message is only for agent eyes (e.g. emit_system_event with send_to_visitor=False).
    # These are excluded from the history sent to the visitor's widget.
    is_agent_only = Column(Boolean, nullable=False, default=False, server_default='false')

    conversation = relationship("Conversation", back_populates="messages")
