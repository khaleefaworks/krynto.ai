"""Website form submissions model.

Stores visitor-submitted form data linked to a conversation.
"""

from sqlalchemy import Column, Integer, ForeignKey, JSON, String
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class WebsiteFormSubmission(Base, TimestampMixin):
    __tablename__ = "website_form_submissions"

    id = Column(Integer, primary_key=True)
    form_id = Column(Integer, ForeignKey("website_forms.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    session_id = Column(String(255), nullable=True)
    data = Column(JSON, nullable=False, default=dict)  # {field_name: value}

    form = relationship("WebsiteForm")
