from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean
from app.models.base import TimestampMixin
from app.core.database import Base


class MessageShortcut(Base, TimestampMixin):
    """
    Quick reply shortcuts for agents.
    
    Agents can type shortcuts like /hello to expand to full messages.
    Example: /hello -> "Hello! How can I help you today?"
    """
    __tablename__ = "message_shortcuts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    shortcut = Column(String(50), nullable=False)  # e.g., "hello" (triggered by /hello or .hello)
    message = Column(Text, nullable=False)  # Full message text
    is_active = Column(Boolean, default=True, nullable=False)
