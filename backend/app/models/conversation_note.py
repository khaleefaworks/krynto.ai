from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from sqlalchemy.sql import func

from app.core.database import Base


class ConversationNote(Base):
    """Private notes for agents on conversations"""
    __tablename__ = "conversation_notes"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)  # Agent who wrote the note
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
