from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.models.base import TimestampMixin
from app.core.database import Base


class AgentSession(Base, TimestampMixin):
    __tablename__ = "agent_sessions"

    id = Column(Integer, primary_key=True)
    agent_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    websocket_id = Column(String(255), nullable=False)
    is_online = Column(Boolean, default=True)
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
