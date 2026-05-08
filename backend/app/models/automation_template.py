from sqlalchemy import Column, Integer, String, Text, JSON

from app.models.base import TimestampMixin
from app.core.database import Base


class AutomationTemplate(Base, TimestampMixin):
    __tablename__ = "automation_templates"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    trigger = Column(String(100), nullable=False, index=True)
    category = Column(String(50), nullable=False, default='auto_message')
    nodes = Column(JSON, nullable=True, default=list)
    edges = Column(JSON, nullable=True, default=list)
