"""Conversation rating model.

Stores a visitor's satisfaction rating for a conversation.
Rating values: 1 (good), 0 (neutral), -1 (bad).
"""

from sqlalchemy import Column, Integer, ForeignKey, Text, SmallInteger, String
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class ConversationRating(Base, TimestampMixin):
    __tablename__ = "conversation_ratings"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(
        Integer,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # One rating per conversation
        index=True,
    )
    rating = Column(SmallInteger, nullable=False)  # 1=good, 0=neutral, -1=bad
    feedback = Column(Text, nullable=True)  # Optional text feedback
    session_id = Column(String(255), nullable=True)  # Which visitor session rated

    conversation = relationship("Conversation", backref="rating_obj")
