from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Index

from app.core.database import Base


class AgentStatusLog(Base):
    __tablename__ = "agent_status_log"

    id = Column(Integer, primary_key=True)
    agent_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    is_available = Column(Boolean, nullable=False)
    changed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_agent_status_log_agent_changed", "agent_id", "changed_at"),
        Index("ix_agent_status_log_org_changed", "organization_id", "changed_at"),
    )
