from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class AgentWebsiteAssignment(Base, TimestampMixin):
    """
    Many-to-many relationship between agents and websites.
    
    This allows pre-assigning agents to specific websites so they can
    access conversations and knowledge for those websites.
    """
    __tablename__ = "agent_website_assignments"

    id = Column(Integer, primary_key=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)

    # Ensure an agent can only be assigned to a website once
    __table_args__ = (
        UniqueConstraint('agent_id', 'website_id', name='uq_agent_website'),
        Index('ix_agent_website_assignments_agent_id', 'agent_id'),
        Index('ix_agent_website_assignments_website_id', 'website_id'),
    )

    # Relationships (optional, can be added to Agent and Website models)
    # agent = relationship("Agent", back_populates="website_assignments")
    # website = relationship("Website", back_populates="agent_assignments")
