from sqlalchemy import Column, Integer, String, Boolean, Enum as SQLEnum, DateTime
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class UserRole(str, enum.Enum):
    """User role enumeration for access control"""
    FULL_ACCESS = "full_access"       # Admin - can manage everything
    LIMITED_ACCESS = "limited_access"  # Agent - can only handle chats


class User(Base):
    """
    Unified user model for both Admins and Agents.
    
    Replaces the old Agent-only model with a role-based system:
    - FULL_ACCESS: Admins can manage websites, agents, settings, AI config
    - LIMITED_ACCESS: Agents can only handle chats and personal settings
    
    Admins can also act as agents (handle chats).
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    role = Column(
        SQLEnum(UserRole, name="user_role"),
        nullable=False,
        default=UserRole.LIMITED_ACCESS,
    )

    # Presence & availability
    is_available = Column(Boolean, default=True, nullable=False)  # Can receive chats
    is_active = Column(Boolean, default=True, nullable=False)      # Account enabled

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def is_admin(self) -> bool:
        """Check if user has admin privileges"""
        return self.role == UserRole.FULL_ACCESS
