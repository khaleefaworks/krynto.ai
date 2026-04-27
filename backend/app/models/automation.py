from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class Automation(Base, TimestampMixin):
    __tablename__ = "automations"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    trigger = Column(String(100), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    category = Column(String(50), nullable=False, default='auto_message', server_default='auto_message', index=True)
    conditions = Column(JSON, nullable=True, default={})
    actions = Column(JSON, nullable=True, default={})

    website = relationship("Website", back_populates="automations")
