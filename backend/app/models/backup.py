from sqlalchemy import Column, Integer, String, BigInteger, Text, Enum as SQLEnum
import enum

from app.models.base import TimestampMixin
from app.core.database import Base


class BackupStatus(str, enum.Enum):
    """Lifecycle of a single backup (or restore-triggered safety backup)."""
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class BackupTrigger(str, enum.Enum):
    """What caused this backup to be created."""
    SCHEDULED = "scheduled"
    MANUAL = "manual"
    PRE_RESTORE_SAFETY = "pre_restore_safety"


class Backup(Base, TimestampMixin):
    """
    Tracks generated DB+uploads backup archives (SA2).

    filename is relative to the configured backup directory, never an
    absolute path, so the storage location can move without stale rows.
    """
    __tablename__ = "backups"

    id = Column(Integer, primary_key=True, index=True)

    filename = Column(String(255), nullable=False, unique=True)
    size_bytes = Column(BigInteger, nullable=True)

    # Schema version recorded at backup time — the alembic_version table's
    # content when pg_dump ran. Used to compute the compatibility badge
    # against the currently running app's alembic heads at restore time.
    alembic_revision = Column(String(32), nullable=True)
    # Best-effort code version; may be absent in a non-git deploy.
    git_commit = Column(String(40), nullable=True)

    status = Column(
        SQLEnum(
            BackupStatus,
            name="backup_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=BackupStatus.IN_PROGRESS,
    )
    triggered_by = Column(
        SQLEnum(
            BackupTrigger,
            name="backup_trigger",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
    )
    error_message = Column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<Backup(id={self.id}, filename={self.filename}, status={self.status})>"
