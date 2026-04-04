from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class Organization(Base, TimestampMixin):
    """
    Multi-tenant organization model.

    Every resource (Website, User except SYSTEM_MANAGER) belongs to exactly one org.
    SYSTEM_MANAGER users have organization_id = NULL and are platform-wide.
    """
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)  # URL-safe, e.g. "acme-corp"

    # Soft reference to the OWNER user; SET NULL on owner deletion so the org survives.
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    plan = Column(String(50), default="free", nullable=False)  # "free" | "pro" | "enterprise"
    is_active = Column(Boolean, default=True, nullable=False)

    # Per-org config: office hours thresholds, limits, etc.
    settings = Column(JSON, nullable=True)

    # Relationships
    users = relationship(
        "User",
        back_populates="organization",
        foreign_keys="User.organization_id",
        lazy="dynamic",
    )
    websites = relationship(
        "Website",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    owner = relationship("User", foreign_keys=[owner_id])
