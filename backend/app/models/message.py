import enum
from sqlalchemy import Column, Integer, ForeignKey, Text, String, Enum as SQLEnum

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
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    sender_type = Column(
        SQLEnum(MessageSenderType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MessageSenderType.VISITOR
    )
    sender = Column(String(50))  # Kept for backward compatibility (email/name)
    # Additional subtype for SYSTEM messages (e.g. automation_welcome, agent_join)
    event_type = Column(String(50), nullable=True)
    content = Column(Text, nullable=False)
