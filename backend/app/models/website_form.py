"""Website forms model.

Stores configurable contact/lead capture forms per website.
Forms can be displayed to visitors via the show_form automation action.
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class WebsiteForm(Base, TimestampMixin):
    __tablename__ = "website_forms"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)   # Admin label e.g. "Offline contact"
    slug = Column(String(60), nullable=False)     # Machine key, unique per website
    fields = Column(JSON, nullable=False, default=list)  # Ordered field descriptors
    submit_label = Column(String(80), nullable=False, server_default="Send")
    enabled = Column(Boolean, nullable=False, server_default="true")

    website = relationship("Website")
