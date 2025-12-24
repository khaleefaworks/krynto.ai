from sqlalchemy import Column, Integer, String, ForeignKey, Boolean

from app.models.base import TimestampMixin
from app.core.database import Base


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=False)
    session_id = Column(String(255), nullable=False)
    status = Column(String(50), default="active")
    is_handoff = Column(Boolean, default=False)
    assigned_agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
