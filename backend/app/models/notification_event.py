from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class NotificationEventStatus(str, enum.Enum):
    """Status of a notification delivery attempt."""
    PENDING = "pending"        # Awaiting first delivery attempt
    SENT = "sent"              # Sent to push service (may not be delivered to device)
    DELIVERED = "delivered"    # Confirmed delivered to agent device
    FAILED = "failed"          # Exhausted retry attempts


class NotificationEventDeliveryMethod(str, enum.Enum):
    """How the notification was delivered."""
    PUSH = "push"              # Web Push (VAPID)
    WS = "ws"                  # WebSocket real-time
    EMAIL = "email"            # Email (future)


class NotificationEvent(Base):
    """
    Track all notification delivery attempts for audit, retry, and deduplication.

    Purpose:
    - Audit trail: record every notification sent to every agent
    - Retry mechanism: automatic retry with exponential backoff for failed pushes
    - Deduplication: prevent duplicate notifications at database level
    """
    __tablename__ = "notification_events"

    id = Column(Integer, primary_key=True, index=True)

    # What conversation triggered this notification
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Which agent received this notification
    agent_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # What event triggered the notification
    trigger_type = Column(String(50), nullable=False)  # "new_chat", "visitor_message", "bot_message"

    # Optional: which message triggered this (for audit trail)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

    # How we tried to deliver it
    delivery_method = Column(
        SQLEnum(NotificationEventDeliveryMethod, name="notification_delivery_method"),
        nullable=False,
        default=NotificationEventDeliveryMethod.PUSH,
    )

    # Delivery status
    status = Column(
        SQLEnum(NotificationEventStatus, name="notification_event_status"),
        nullable=False,
        default=NotificationEventStatus.PENDING,
    )

    # Retry tracking
    attempt_count = Column(Integer, default=0, nullable=False)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)  # Index for retry queries

    # Error tracking
    error_message = Column(Text, nullable=True)  # Last error encountered

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<NotificationEvent(id={self.id}, agent_id={self.agent_id}, conv_id={self.conversation_id}, status={self.status})>"
