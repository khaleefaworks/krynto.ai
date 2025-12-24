from sqlalchemy import Column, Integer, ForeignKey, Text, String

from app.models.base import TimestampMixin
from app.core.database import Base


class Message(Base, TimestampMixin):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    sender = Column(String(50))
    content = Column(Text, nullable=False)
