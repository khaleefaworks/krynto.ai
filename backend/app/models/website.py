from sqlalchemy import Column, Integer, String, Text, JSON, Boolean
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class Website(Base, TimestampMixin):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), unique=True, nullable=False)
    ai_instructions = Column(Text, nullable=True)
    
    # AI enablement flag (Milestone 3 - data-only, not used in routing yet)
    ai_enabled = Column(Boolean, default=False, nullable=False)
    
    # Widget configuration
    widget_config = Column(JSON, nullable=True, default={})

    knowledge_sources = relationship(
        "KnowledgeSource",
        back_populates="website",
        cascade="all, delete-orphan",
    )
