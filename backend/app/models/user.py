from sqlalchemy import Column, Integer, String, Boolean, Enum as SQLEnum, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class UserRole(str, enum.Enum):
    """User role enumeration for access control"""
    SYSTEM_MANAGER = "system_manager"  # Platform-wide super-admin; organization_id = NULL
    OWNER = "owner"                    # Org owner; full control within their org
    MANAGER = "manager"                # Org manager; all admin features except org deletion
    AGENT = "agent"                    # Agent - only chat handling and personal settings


class User(Base):
    """
    Unified user model for Admins, Managers, and Agents.
    
    Role-based access system:
    - SYSTEM_MANAGER (Administrator): Full system access including reset application
    - MANAGER: All admin features except reset application
    - AGENT: Only chat handling and personal settings
    
    Any user can be assigned to websites to handle chats.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(String(500), nullable=True)  # User profile picture URL

    role = Column(
        SQLEnum(UserRole, name="user_role", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=UserRole.AGENT,
    )

    # Presence & availability
    is_available = Column(Boolean, default=False, nullable=False)  # Can receive chats
    is_active = Column(Boolean, default=True, nullable=False)      # Account enabled
    is_deleted = Column(Boolean, default=False, nullable=False)    # Soft-deleted (hidden from UI)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Multi-tenant: NULL for SYSTEM_MANAGER (platform-wide), set for all other roles.
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)

    # Session invalidation: tokens issued before this timestamp are rejected.
    password_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Email verification: set True after OTP confirmed on signup.
    # Existing users and admin-invited users default to True (no OTP required).
    is_email_verified = Column(Boolean, default=True, nullable=False, server_default="true")

    # Heartbeat (presence)
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True, index=True)

    organization = relationship(
        "Organization",
        back_populates="users",
        foreign_keys=[organization_id],
    )

    def is_superadmin(self) -> bool:
        """Check if user is the platform-wide super-admin."""
        return self.role == UserRole.SYSTEM_MANAGER

    def is_org_owner(self) -> bool:
        """Check if user is the owner of their organisation."""
        return self.role == UserRole.OWNER

    def is_admin(self) -> bool:
        """Check if user has admin privileges (SYSTEM_MANAGER, OWNER, or MANAGER)."""
        return self.role in [UserRole.SYSTEM_MANAGER, UserRole.OWNER, UserRole.MANAGER]

    def is_administrator(self) -> bool:
        """Check if user is the platform-wide SYSTEM_MANAGER."""
        return self.role == UserRole.SYSTEM_MANAGER
