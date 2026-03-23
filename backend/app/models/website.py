from sqlalchemy import Column, Integer, String, JSON, Boolean, ForeignKey
from sqlalchemy.orm import relationship
import secrets

from app.models.base import TimestampMixin
from app.core.database import Base


def generate_widget_key():
    """Generate a secure random widget key"""
    return secrets.token_hex(32)  # 64 character hex string


class Website(Base, TimestampMixin):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), unique=True, nullable=False)
    widget_key = Column(String(64), unique=True, nullable=False, default=generate_widget_key, index=True)
    
    # Multi-tenant: every website belongs to an organisation.
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    # Widget configuration
    widget_config = Column(JSON, nullable=True, default={})

    # Conversation history feature flag (routing logic, not cosmetic — must be a real column).
    show_conversation_history = Column(Boolean, nullable=False, default=False)

    organization = relationship("Organization", back_populates="websites")
    conversations = relationship("Conversation", back_populates="website", cascade="all, delete-orphan")
    automations = relationship("Automation", back_populates="website", cascade="all, delete-orphan")
    teams = relationship("WebsiteTeam", back_populates="website", cascade="all, delete-orphan")
