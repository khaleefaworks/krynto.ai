from sqlalchemy import Column, Integer, String, ForeignKey, Text

from app.models.base import TimestampMixin
from app.core.database import Base


class ConversationPageView(Base, TimestampMixin):
    __tablename__ = "conversation_page_views"

    id = Column(Integer, primary_key=True)

    website_id = Column(Integer, ForeignKey("websites.id"), nullable=False)
    session_id = Column(String(255), nullable=False)

    # Nullable so we can store events before the conversation is created.
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=True)

    title = Column(String(255), nullable=True)
    url = Column(Text, nullable=False)
    referrer = Column(Text, nullable=True)

    # Best-effort device/browser snapshot at the time of the page view.
    device_info = Column(String(255), nullable=True)
    browser_info = Column(String(255), nullable=True)
