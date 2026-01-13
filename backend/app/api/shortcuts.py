from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel, Field
from datetime import datetime

from app.core.database import get_db
from app.api.deps import require_authenticated_user
from app.models.user import User
from app.models.message_shortcut import MessageShortcut

router = APIRouter(prefix="/shortcuts", tags=["shortcuts"])


def _normalize_shortcut(raw: str) -> str:
    value = (raw or "").strip()
    value = value.lstrip("/.")
    value = value.strip()
    return value


class MessageShortcutCreate(BaseModel):
    shortcut: str = Field(..., min_length=1, max_length=50, description="Shortcut name (e.g., hello). Trigger with /hello or .hello")
    message: str = Field(..., min_length=1, description="Full message text")
    is_active: bool = True


class MessageShortcutUpdate(BaseModel):
    shortcut: str | None = Field(None, min_length=1, max_length=50)
    message: str | None = Field(None, min_length=1)
    is_active: bool | None = None


class MessageShortcutResponse(BaseModel):
    id: int
    user_id: int
    shortcut: str
    message: str
    is_active: bool
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True


@router.get("", response_model=List[MessageShortcutResponse])
def list_shortcuts(
    q: str | None = None,
    active_only: bool = False,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    List personal message shortcuts for the current user.
    """
    query = db.query(MessageShortcut).filter(MessageShortcut.user_id == current_user.id)
    if active_only:
        query = query.filter(MessageShortcut.is_active.is_(True))
    if q:
        needle = f"%{q.strip()}%"
        query = query.filter(
            (MessageShortcut.shortcut.ilike(needle)) | (MessageShortcut.message.ilike(needle))
        )

    shortcuts = query.order_by(MessageShortcut.shortcut.asc()).all()
    return shortcuts


@router.post("", response_model=MessageShortcutResponse, status_code=status.HTTP_201_CREATED)
def create_shortcut(
    shortcut_data: MessageShortcutCreate,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Create a personal message shortcut for the current user.
    """
    normalized = _normalize_shortcut(shortcut_data.shortcut)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot be empty")
    if any(ch.isspace() for ch in normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot contain spaces")

    # Check if shortcut already exists for this user
    existing = db.query(MessageShortcut).filter(
        MessageShortcut.user_id == current_user.id,
        MessageShortcut.shortcut == normalized
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Shortcut '{normalized}' already exists"
        )

    shortcut = MessageShortcut(
        user_id=current_user.id,
        shortcut=normalized,
        message=shortcut_data.message,
        is_active=shortcut_data.is_active,
    )
    db.add(shortcut)
    db.commit()
    db.refresh(shortcut)
    
    return shortcut


@router.get("/{shortcut_id}", response_model=MessageShortcutResponse)
def get_shortcut(
    shortcut_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Get a specific message shortcut by ID"""
    shortcut = db.query(MessageShortcut).filter(
        MessageShortcut.id == shortcut_id,
        MessageShortcut.user_id == current_user.id,
    ).first()
    
    if not shortcut:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortcut not found"
        )
    
    return shortcut


@router.put("/{shortcut_id}", response_model=MessageShortcutResponse)
def update_shortcut(
    shortcut_id: int,
    shortcut_data: MessageShortcutUpdate,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Update a message shortcut"""
    shortcut = db.query(MessageShortcut).filter(
        MessageShortcut.id == shortcut_id,
        MessageShortcut.user_id == current_user.id,
    ).first()
    
    if not shortcut:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortcut not found"
        )
    
    # Check for duplicate shortcut if changing it
    if shortcut_data.shortcut is not None:
        normalized = _normalize_shortcut(shortcut_data.shortcut)
        if not normalized:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot be empty")
        if any(ch.isspace() for ch in normalized):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shortcut cannot contain spaces")

    if shortcut_data.shortcut and _normalize_shortcut(shortcut_data.shortcut) != shortcut.shortcut:
        normalized = _normalize_shortcut(shortcut_data.shortcut)
        existing = db.query(MessageShortcut).filter(
            MessageShortcut.user_id == current_user.id,
            MessageShortcut.shortcut == normalized,
            MessageShortcut.id != shortcut_id
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Shortcut '{normalized}' already exists"
            )
    
    payload = shortcut_data.model_dump(exclude_unset=True)
    if 'shortcut' in payload and payload['shortcut'] is not None:
        payload['shortcut'] = _normalize_shortcut(payload['shortcut'])

    for field, value in payload.items():
        setattr(shortcut, field, value)
    
    db.commit()
    db.refresh(shortcut)
    
    return shortcut


@router.delete("/{shortcut_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortcut(
    shortcut_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Delete a message shortcut"""
    shortcut = db.query(MessageShortcut).filter(
        MessageShortcut.id == shortcut_id,
        MessageShortcut.user_id == current_user.id,
    ).first()
    
    if not shortcut:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortcut not found"
        )
    
    db.delete(shortcut)
    db.commit()
    
    return None
