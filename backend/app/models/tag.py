from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class Tag(Base, TimestampMixin):
    """Tag definition scoped to a specific website."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("name", "website_id", name="uq_tags_name_website"),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=False, server_default="#000000")  # Hex color code
    description = Column(String(255), nullable=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)

    website = relationship("Website")
    conversations = relationship("ConversationTag", back_populates="tag")
