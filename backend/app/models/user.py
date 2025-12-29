from sqlalchemy import Column, Integer, String, Boolean, Enum as SQLEnum, DateTime
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class UserRole(str, enum.Enum):
    """User role enumeration for access control"""
    FULL_ACCESS = "full_access"       # Administrator - full system access including reset
    MANAGER = "manager"                # Manager - all access except reset application
    AGENT = "agent"                    # Agent - only chat handling and personal settings


class User(Base):
    """
    Unified user model for Admins, Managers, and Agents.
    
    Role-based access system:
    - FULL_ACCESS (Administrator): Full system access including reset application
    - MANAGER: All admin features except reset application
    - AGENT: Only chat handling and personal settings
    
    Any user can be assigned to websites to handle chats.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    role = Column(
        SQLEnum(UserRole, name="user_role", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=UserRole.AGENT,
    )

    # Presence & availability
    is_available = Column(Boolean, default=True, nullable=False)  # Can receive chats
    is_active = Column(Boolean, default=True, nullable=False)      # Account enabled

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def is_admin(self) -> bool:
        """Check if user has admin privileges (full access or manager)"""
        return self.role in [UserRole.FULL_ACCESS, UserRole.MANAGER]
    
    def is_administrator(self) -> bool:
        """Check if user is administrator with full access including reset"""
        return self.role == UserRole.FULL_ACCESS
