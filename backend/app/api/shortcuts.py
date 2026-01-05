from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.deps import require_administrator
from app.models.user import User
from app.models.message_shortcut import MessageShortcut

router = APIRouter(prefix="/shortcuts", tags=["shortcuts"])


class MessageShortcutCreate(BaseModel):
    website_id: int
    shortcut: str = Field(..., min_length=1, max_length=50, description="Shortcut code (e.g., /hello)")
    message: str = Field(..., min_length=1, description="Full message text")


class MessageShortcutUpdate(BaseModel):
    shortcut: str | None = Field(None, min_length=1, max_length=50)
    message: str | None = Field(None, min_length=1)


class MessageShortcutResponse(BaseModel):
    id: int
    website_id: int
    shortcut: str
    message: str
    created_at: str
    updated_at: str | None

    class Config:
        from_attributes = True


@router.get("", response_model=List[MessageShortcutResponse])
def list_shortcuts(
    website_id: int | None = None,
    current_user: User = Depends(require_administrator),
    db: Session = Depends(get_db)
):
    """
    List all message shortcuts.
    Optionally filter by website_id.
    """
    query = db.query(MessageShortcut)
    
    if website_id:
        query = query.filter(MessageShortcut.website_id == website_id)
    
    shortcuts = query.order_by(MessageShortcut.shortcut).all()
    return shortcuts


@router.post("", response_model=MessageShortcutResponse, status_code=status.HTTP_201_CREATED)
def create_shortcut(
    shortcut_data: MessageShortcutCreate,
    current_user: User = Depends(require_administrator),
    db: Session = Depends(get_db)
):
    """
    Create a new message shortcut.
    Only administrators can create shortcuts.
    """
    # Check if shortcut already exists for this website
    existing = db.query(MessageShortcut).filter(
        MessageShortcut.website_id == shortcut_data.website_id,
        MessageShortcut.shortcut == shortcut_data.shortcut
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Shortcut '{shortcut_data.shortcut}' already exists for this website"
        )
    
    shortcut = MessageShortcut(**shortcut_data.model_dump())
    db.add(shortcut)
    db.commit()
    db.refresh(shortcut)
    
    return shortcut


@router.get("/{shortcut_id}", response_model=MessageShortcutResponse)
def get_shortcut(
    shortcut_id: int,
    current_user: User = Depends(require_administrator),
    db: Session = Depends(get_db)
):
    """Get a specific message shortcut by ID"""
    shortcut = db.query(MessageShortcut).filter(MessageShortcut.id == shortcut_id).first()
    
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
    current_user: User = Depends(require_administrator),
    db: Session = Depends(get_db)
):
    """Update a message shortcut"""
    shortcut = db.query(MessageShortcut).filter(MessageShortcut.id == shortcut_id).first()
    
    if not shortcut:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortcut not found"
        )
    
    # Check for duplicate shortcut if changing it
    if shortcut_data.shortcut and shortcut_data.shortcut != shortcut.shortcut:
        existing = db.query(MessageShortcut).filter(
            MessageShortcut.website_id == shortcut.website_id,
            MessageShortcut.shortcut == shortcut_data.shortcut,
            MessageShortcut.id != shortcut_id
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Shortcut '{shortcut_data.shortcut}' already exists for this website"
            )
    
    # Update fields
    for field, value in shortcut_data.model_dump(exclude_unset=True).items():
        setattr(shortcut, field, value)
    
    db.commit()
    db.refresh(shortcut)
    
    return shortcut


@router.delete("/{shortcut_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortcut(
    shortcut_id: int,
    current_user: User = Depends(require_administrator),
    db: Session = Depends(get_db)
):
    """Delete a message shortcut"""
    shortcut = db.query(MessageShortcut).filter(MessageShortcut.id == shortcut_id).first()
    
    if not shortcut:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortcut not found"
        )
    
    db.delete(shortcut)
    db.commit()
    
    return None
