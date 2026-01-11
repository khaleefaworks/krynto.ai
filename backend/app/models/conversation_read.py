from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint

from app.core.database import Base
from app.models.base import TimestampMixin


class ConversationRead(Base, TimestampMixin):
    __tablename__ = "conversation_reads"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Timestamp representing "I have read up to now" for this conversation.
    last_read_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversation_reads_conversation_user"),
    )
