from sqlalchemy import Column, Integer, String, Text

from app.models.base import TimestampMixin
from app.core.database import Base


class Website(Base, TimestampMixin):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), unique=True, nullable=False)
    ai_instructions = Column(Text, nullable=True)
