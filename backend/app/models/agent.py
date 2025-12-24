from sqlalchemy import Column, Integer, String, Boolean

from app.models.base import TimestampMixin
from app.core.database import Base


class Agent(Base, TimestampMixin):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
