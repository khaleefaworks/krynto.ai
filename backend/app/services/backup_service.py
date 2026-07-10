"""SA2: DB + uploads backup/restore, with Alembic-revision-based version
compatibility checking (see docs/tasks.md SA2 for the design rationale).

All functions here are synchronous and do real subprocess/filesystem I/O —
callers (API routes, the scheduler job) are responsible for running them off
the request thread (see notification_service.py's executor pattern).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.core.uploads import get_uploads_root
from app.models.backup import Backup, BackupStatus, BackupTrigger

logger = get_logger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
BACKUP_RETENTION_COUNT = 12


def _backup_dir() -> Path:
    p = BACKEND_ROOT / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_backup_file_path(filename: str) -> Path:
    """Public accessor for callers (e.g. the download endpoint) that only
    need the resolved path, not the directory-creation side effect."""
    return _backup_dir() / filename


def _pg_cli_url() -> str:
    """DATABASE_URL with the SQLAlchemy driver suffix stripped — pg_dump/psql
    want a plain postgresql:// URI, not postgresql+psycopg2://."""
    return settings.DATABASE_URL.replace("+psycopg2", "")


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(BACKEND_ROOT), capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Version compatibility
# ---------------------------------------------------------------------------

def _script_directory():
    from alembic.config import Config as AlembicConfig
    from alembic.script import ScriptDirectory

    cfg = AlembicConfig(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return ScriptDirectory.from_config(cfg)


def get_current_alembic_heads() -> list[str]:
    return list(_script_directory().get_heads())


def compute_compatibility(backup_revision: str | None, script_dir=None) -> str:
    """Compare a backup's recorded alembic revision against the currently
    running app's migration graph.

    Returns "match" (exact head), "older" (a real ancestor — `alembic
    upgrade head` after restore brings it forward safely), or "unknown"
    (not found anywhere in the current graph — newer/diverged/foreign;
    the ORM models may not even match the dump's schema).
    """
    if not backup_revision:
        return "unknown"
    sd = script_dir or _script_directory()
    heads = set(sd.get_heads())
    if backup_revision in heads:
        return "match"
    all_revisions = {rev.revision for rev in sd.walk_revisions()}
    if backup_revision in all_revisions:
        return "older"
    return "unknown"


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

def create_backup(*, triggered_by: BackupTrigger) -> Backup:
    """Dump the DB + uploads dir into one timestamped archive on local disk."""
    db = SessionLocal()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"backup-{timestamp}.tar.gz"
    backup = Backup(filename=filename, triggered_by=triggered_by, status=BackupStatus.IN_PROGRESS)
    db.add(backup)
    db.commit()
    db.refresh(backup)

    work_dir = _backup_dir() / f".tmp-{timestamp}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        current_revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar()

        dump_path = work_dir / "db.sql"
        # --clean --if-exists: dump includes DROP-before-CREATE statements,
        # so restoring is safe to replay directly against an already
        # populated database, not just an empty one.
        result = subprocess.run(
            ["pg_dump", "--no-owner", "--no-privileges", "--clean", "--if-exists",
             "-f", str(dump_path), _pg_cli_url()],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {result.stderr[:2000]}")

        git_commit = _git_commit()
        uploads_root = get_uploads_root()
        manifest = {
            "created_at": timestamp,
            "alembic_revision": current_revision,
            "git_commit": git_commit,
            "has_uploads": uploads_root.exists(),
        }
        (work_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

        archive_path = _backup_dir() / filename
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(dump_path, arcname="db.sql")
            tar.add(work_dir / "manifest.json", arcname="manifest.json")
            if uploads_root.exists():
                tar.add(uploads_root, arcname="uploads")

        backup.status = BackupStatus.COMPLETED
        backup.size_bytes = archive_path.stat().st_size
        backup.alembic_revision = current_revision
        backup.git_commit = git_commit
        db.commit()
        logger.info("backup_created", backup_id=backup.id, filename=filename, size_bytes=backup.size_bytes)

        _prune_old_backups(db)
        # Commit expires every attribute by default — force a reload while the
        # session is still open, then detach, so the returned object is a
        # usable in-memory snapshot instead of raising DetachedInstanceError
        # the moment a caller touches it after this function returns.
        db.refresh(backup)
        db.expunge(backup)
        return backup
    except Exception as e:
        backup.status = BackupStatus.FAILED
        backup.error_message = str(e)[:2000]
        db.commit()
        logger.error("backup_failed", backup_id=backup.id, error=str(e))
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        db.close()


def _prune_old_backups(db) -> None:
    completed = (
        db.query(Backup)
        .filter(Backup.status == BackupStatus.COMPLETED)
        .order_by(Backup.created_at.desc())
        .all()
    )
    for old in completed[BACKUP_RETENTION_COUNT:]:
        try:
            path = _backup_dir() / old.filename
            if path.exists():
                path.unlink()
            db.delete(old)
        except Exception as e:
            logger.warning("backup_prune_failed", backup_id=old.id, error=str(e))
    db.commit()


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

def _terminate_other_connections(db) -> None:
    """Standard technique before replaying a dump into a live database —
    other connections holding locks/old state would otherwise conflict with
    or survive past the restore. In-flight requests during this brief window
    are expected to error; that's the accepted cost of a rare, explicit,
    admin-triggered restore, not a background task."""
    db.execute(text(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE datname = current_database() AND pid <> pg_backend_pid()"
    ))
    db.commit()


def _run_alembic_upgrade_head() -> None:
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=str(BACKEND_ROOT), capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade head failed post-restore: {result.stderr[:2000]}")


# In-memory restore job status, keyed by backup_id. A restore is a rare,
# single-admin, sequential action — a full job-tracking table would be
# overkill; if the process restarts mid-restore the restore itself has
# already succeeded or failed by then, and the PRE_RESTORE_SAFETY backup
# row it creates still gives a durable audit trail either way.
_restore_state: dict[int, dict] = {}


def get_restore_status(backup_id: int) -> dict | None:
    return _restore_state.get(backup_id)


def restore_backup(*, backup_id: int, force: bool = False) -> None:
    """Restore a backup archive over the current database + uploads dir.

    Destructive — only call from a properly gated, explicitly-confirmed
    admin action. Always takes a PRE_RESTORE_SAFETY backup of current state
    first, so a bad restore can itself be undone.
    """
    _restore_state[backup_id] = {"status": "running", "error": None}
    db = SessionLocal()
    try:
        backup = db.query(Backup).filter(Backup.id == backup_id).first()
        if not backup or backup.status != BackupStatus.COMPLETED:
            raise ValueError("Backup not found or not completed")

        compat = compute_compatibility(backup.alembic_revision)
        if compat == "unknown" and not force:
            raise ValueError(
                "This backup's schema version isn't recognized by the "
                "currently running app. Pass force=True to restore anyway."
            )

        archive_path = _backup_dir() / backup.filename
        if not archive_path.exists():
            raise FileNotFoundError(f"Backup file missing on disk: {backup.filename}")

        # Safety net before touching anything.
        create_backup(triggered_by=BackupTrigger.PRE_RESTORE_SAFETY)

        work_dir = _backup_dir() / f".restore-{backup.id}"
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            with tarfile.open(archive_path, "r:gz") as tar:
                tar.extractall(work_dir)

            _terminate_other_connections(db)

            dump_path = work_dir / "db.sql"
            result = subprocess.run(
                ["psql", _pg_cli_url(), "-f", str(dump_path)],
                capture_output=True, text=True, timeout=1800,
            )
            if result.returncode != 0:
                raise RuntimeError(f"restore failed: {result.stderr[:2000]}")

            uploads_src = work_dir / "uploads"
            if uploads_src.exists():
                uploads_root = get_uploads_root()
                if uploads_root.exists():
                    shutil.rmtree(uploads_root)
                shutil.copytree(uploads_src, uploads_root)

            _run_alembic_upgrade_head()
            logger.info("backup_restored", backup_id=backup.id, force=force)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
    except Exception as e:
        _restore_state[backup_id] = {"status": "failed", "error": str(e)[:2000]}
        logger.error("backup_restore_failed", backup_id=backup_id, error=str(e))
        return
    finally:
        db.close()
    _restore_state[backup_id] = {"status": "completed", "error": None}


def run_scheduled_backup() -> None:
    """Entry point for the scheduler job — swallows errors so one failed
    backup attempt doesn't take down the job registration (create_backup
    already records the failure on the Backup row itself)."""
    try:
        create_backup(triggered_by=BackupTrigger.SCHEDULED)
    except Exception as e:
        logger.error("scheduled_backup_failed", error=str(e))
