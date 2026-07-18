"""Tracks each attempt to push a captured lead out to a WebsiteIntegration.

Mirrors NotificationEvent's audit/retry shape (same reason: external
delivery can fail transiently and needs backoff + a paper trail), scoped to
outbound lead pushes instead of push notifications.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class LeadDeliveryStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class LeadIntegrationDelivery(Base):
    __tablename__ = "lead_integration_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    integration_id = Column(Integer, ForeignKey("website_integrations.id", ondelete="CASCADE"), nullable=False, index=True)
    # "offline_gate" | "live_chat_form" — which capture path produced this lead.
    source = Column(String(30), nullable=False)
    payload = Column(JSON, nullable=False)

    status = Column(
        SQLEnum(
            LeadDeliveryStatus,
            name="lead_delivery_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=LeadDeliveryStatus.PENDING,
    )
    attempt_count = Column(Integer, default=0, nullable=False)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    integration = relationship("WebsiteIntegration")
