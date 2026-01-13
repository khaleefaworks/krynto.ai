from sqlalchemy import Column, Integer, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class ConversationTag(Base):
    """Association between conversations and tags"""
    __tablename__ = "conversation_tags"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Agent who added the tag

    conversation = relationship("Conversation", back_populates="tags")
    tag = relationship("Tag", back_populates="conversations")
    creator = relationship("User")
