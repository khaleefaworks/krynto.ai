from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.sql import func

from app.core.database import Base


class ConversationTag(Base):
    """Tags for categorizing conversations"""
    __tablename__ = "conversation_tags"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    tag_name = Column(String(100), nullable=False)  # e.g., "urgent", "billing", "support"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Agent who added the tag
