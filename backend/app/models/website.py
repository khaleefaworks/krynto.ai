from sqlalchemy import Column, Integer, String, JSON
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
    
    # Widget configuration
    widget_config = Column(JSON, nullable=True, default={})
