from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_authenticated_user
from app.core.database import get_db
from app.models.user import User
from app.models.website import Website
from app.models.website_message_shortcut import WebsiteMessageShortcut
from app.services.visibility import compute_visibility_scope, ensure_website_visible


router = APIRouter(prefix="/websites/{website_id}/shortcuts", tags=["Website Shortcuts"])


def _normalize_shortcut(raw: str) -> str:
    value = (raw or "").strip()
    value = value.lstrip("/.")
    value = value.strip()
    return value


class WebsiteShortcutCreate(BaseModel):
    shortcut: str = Field(..., min_length=1, max_length=50)
    message: str = Field(..., min_length=1)
    is_active: bool = True


class WebsiteShortcutUpdate(BaseModel):
    shortcut: str | None = Field(None, min_length=1, max_length=50)
    message: str | None = Field(None, min_length=1)
    is_active: bool | None = None


class WebsiteShortcutResponse(BaseModel):
    id: int
    website_id: int
    shortcut: str
    message: str
    is_active: bool
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True


def _ensure_website_exists(db: Session, *, website_id: int) -> Website:
    website = db.query(Website).filter(Website.id == int(website_id)).first()
    if not website:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website not found")
    return website


def _ensure_website_access(db: Session, *, website_id: int, user: User) -> None:
    if user.is_administrator():
        return
    scope = compute_visibility_scope(db, user=user)
    try:
        ensure_website_visible(scope, website_id=int(website_id))
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Website not assigned")


@router.get("", response_model=List[WebsiteShortcutResponse])
def list_website_shortcuts(
    website_id: int,
    q: str | None = None,
    active_only: bool = False,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    _ensure_website_exists(db, website_id=int(website_id))
    _ensure_website_access(db, website_id=int(website_id), user=current_user)

    query = db.query(WebsiteMessageShortcut).filter(WebsiteMessageShortcut.website_id == int(website_id))
    if active_only:
        query = query.filter(WebsiteMessageShortcut.is_active.is_(True))
    if q:
        needle = f"%{q.strip()}%"
        query = query.filter(
            (WebsiteMessageShortcut.shortcut.ilike(needle)) | (WebsiteMessageShortcut.message.ilike(needle))
        )
    return query.order_by(WebsiteMessageShortcut.shortcut.asc()).all()


@router.post("", response_model=WebsiteShortcutResponse, status_code=status.HTTP_201_CREATED)
def create_website_shortcut(
    website_id: int,
    payload: WebsiteShortcutCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _ensure_website_exists(db, website_id=int(website_id))

    normalized = _normalize_shortcut(payload.shortcut)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot be empty")
    if any(ch.isspace() for ch in normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot contain spaces")

    existing = (
        db.query(WebsiteMessageShortcut)
        .filter(
            WebsiteMessageShortcut.website_id == int(website_id),
            WebsiteMessageShortcut.shortcut == normalized,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Shortcut '{normalized}' already exists",
        )

    row = WebsiteMessageShortcut(
        website_id=int(website_id),
        shortcut=normalized,
        message=payload.message,
        is_active=bool(payload.is_active),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{shortcut_id}", response_model=WebsiteShortcutResponse)
def update_website_shortcut(
    website_id: int,
    shortcut_id: int,
    payload: WebsiteShortcutUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _ensure_website_exists(db, website_id=int(website_id))
    row = (
        db.query(WebsiteMessageShortcut)
        .filter(
            WebsiteMessageShortcut.id == int(shortcut_id),
            WebsiteMessageShortcut.website_id == int(website_id),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortcut not found")

    if payload.shortcut is not None:
        normalized = _normalize_shortcut(payload.shortcut)
        if not normalized:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot be empty")
        if any(ch.isspace() for ch in normalized):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot contain spaces")
        if normalized != row.shortcut:
            dup = (
                db.query(WebsiteMessageShortcut)
                .filter(
                    WebsiteMessageShortcut.website_id == int(website_id),
                    WebsiteMessageShortcut.shortcut == normalized,
                    WebsiteMessageShortcut.id != int(shortcut_id),
                )
                .first()
            )
            if dup:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Shortcut '{normalized}' already exists",
                )
            row.shortcut = normalized

    if payload.message is not None:
        row.message = payload.message
    if payload.is_active is not None:
        row.is_active = bool(payload.is_active)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{shortcut_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_website_shortcut(
    website_id: int,
    shortcut_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _ensure_website_exists(db, website_id=int(website_id))
    row = (
        db.query(WebsiteMessageShortcut)
        .filter(
            WebsiteMessageShortcut.id == int(shortcut_id),
            WebsiteMessageShortcut.website_id == int(website_id),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortcut not found")

    db.delete(row)
    db.commit()
    return None
