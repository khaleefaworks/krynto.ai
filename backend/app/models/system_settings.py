from sqlalchemy import Column, Integer, Boolean, DateTime

from app.core.database import Base


class SystemSettings(Base):
    """
    Global system settings table.
    
    Only ONE row should ever exist in this table.
    Used to track system initialization state and other global flags.
    """
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True)
    is_initialized = Column(Boolean, default=False, nullable=False)
    last_reset_at = Column(DateTime(timezone=True), nullable=True)
