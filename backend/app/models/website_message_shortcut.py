from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text

from app.core.database import Base
from app.models.base import TimestampMixin


class WebsiteMessageShortcut(Base, TimestampMixin):
    """Website-global quick reply shortcuts.

    Managers/System Managers can create shortcuts per website.
    Agents assigned to that website can list/use them.
    """

    __tablename__ = "website_message_shortcuts"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    shortcut = Column(String(50), nullable=False)
    message = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
