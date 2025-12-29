"""
System-level utilities and checks.
"""
from app.core.database import SessionLocal
from app.models.system_settings import SystemSettings


def is_system_initialized() -> bool:
    """
    Check if the system has been initialized with a first admin user.
    
    Returns:
        True if system is initialized, False otherwise
    """
    db = SessionLocal()
    try:
        settings = db.query(SystemSettings).first()
        return bool(settings and settings.is_initialized)
    finally:
        db.close()


def mark_system_initialized(db) -> None:
    """
    Mark the system as initialized.
    Should only be called once during bootstrap.
    
    Args:
        db: Database session
    """
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(is_initialized=True)
        db.add(settings)
    else:
        settings.is_initialized = True
