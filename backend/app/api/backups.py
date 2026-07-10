"""SA2: Backup & Restore admin endpoints. SYSTEM_MANAGER-only, same gate as
the rest of /admin/*."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_administrator
from app.core.database import get_db
from app.models.backup import Backup, BackupStatus, BackupTrigger
from app.models.user import User
from app.services import backup_service

router = APIRouter(prefix="/admin/backups", tags=["admin", "backups"])


class BackupResponse(BaseModel):
    id: int
    filename: str
    size_bytes: int | None
    alembic_revision: str | None
    git_commit: str | None
    status: str
    triggered_by: str
    error_message: str | None
    created_at: str | None
    compatibility: str  # "match" | "older" | "unknown" — computed, not stored


class RestoreRequest(BaseModel):
    force: bool = False


def _to_response(b: Backup) -> BackupResponse:
    compat = (
        backup_service.compute_compatibility(b.alembic_revision)
        if b.status == BackupStatus.COMPLETED
        else "unknown"
    )
    return BackupResponse(
        id=b.id,
        filename=b.filename,
        size_bytes=b.size_bytes,
        alembic_revision=b.alembic_revision,
        git_commit=b.git_commit,
        status=b.status.value if hasattr(b.status, "value") else str(b.status),
        triggered_by=b.triggered_by.value if hasattr(b.triggered_by, "value") else str(b.triggered_by),
        error_message=b.error_message,
        created_at=b.created_at.isoformat() if b.created_at else None,
        compatibility=compat,
    )


@router.get("", response_model=list[BackupResponse])
def list_backups(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    rows = db.query(Backup).order_by(Backup.created_at.desc()).all()
    return [_to_response(b) for b in rows]


@router.post("", response_model=BackupResponse, status_code=202)
async def trigger_backup(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Kick off a manual backup in the background; returns immediately with
    the in-progress row. Poll GET /admin/backups for completion."""
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, lambda: backup_service.create_backup(triggered_by=BackupTrigger.MANUAL))
    # The background task hasn't necessarily inserted its row yet by the time
    # we respond — give the caller the most recent row a moment later via the
    # list endpoint instead of trying to return the not-yet-created one here.
    await asyncio.sleep(0.2)
    latest = db.query(Backup).order_by(Backup.created_at.desc()).first()
    if latest is None:
        raise HTTPException(status_code=500, detail="Backup did not start")
    return _to_response(latest)


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    b = db.query(Backup).filter(Backup.id == backup_id).first()
    if not b or b.status != BackupStatus.COMPLETED:
        raise HTTPException(status_code=404, detail="Backup not found or not completed")
    path = backup_service.get_backup_file_path(b.filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file missing on disk")
    return FileResponse(str(path), filename=b.filename, media_type="application/gzip")


@router.post("/{backup_id}/restore", status_code=202)
async def restore_backup(
    backup_id: int,
    body: RestoreRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    b = db.query(Backup).filter(Backup.id == backup_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Backup not found")
    if b.status != BackupStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Backup is not in a completed state")

    compat = backup_service.compute_compatibility(b.alembic_revision)
    if compat == "unknown" and not body.force:
        raise HTTPException(
            status_code=409,
            detail="This backup's schema version isn't recognized by the running app. "
                   "Set force=true to restore anyway.",
        )

    loop = asyncio.get_running_loop()
    loop.run_in_executor(
        None, lambda: backup_service.restore_backup(backup_id=backup_id, force=body.force)
    )
    return {"status": "started"}


@router.get("/{backup_id}/restore-status")
def restore_status(
    backup_id: int,
    _admin: User = Depends(require_administrator),
):
    status = backup_service.get_restore_status(backup_id)
    if status is None:
        return {"status": "not_started"}
    return status
