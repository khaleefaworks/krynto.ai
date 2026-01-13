from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class Tag(Base, TimestampMixin):
    """Global tag definition used across all websites."""

    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    color = Column(String(7), nullable=False, server_default="#000000")  # Hex color code
    description = Column(String(255), nullable=True)

    conversations = relationship("ConversationTag", back_populates="tag")
