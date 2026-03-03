"""Conversation metadata API.

This module intentionally focuses on metadata that is not part of the core
conversation lifecycle (notes, visitor metadata, page views).

Conversation tag management is handled by the dedicated tags endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime

from app.core.database import get_db
from app.models.conversation_note import ConversationNote
from app.models.conversation import Conversation
from app.models.conversation_page_view import ConversationPageView
from app.api.deps import get_current_user
from app.models.user import User
from app.repos import page_views as page_views_repo
from app.services.visibility import compute_visibility_scope

router = APIRouter(prefix="/conversations", tags=["conversation-metadata"])


def _ensure_visible(db: Session, *, current_user: User, conversation_id: int) -> Conversation:
    conversation = db.query(Conversation).filter_by(id=int(conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and int(conversation.website_id) not in set(scope.website_ids):
        raise HTTPException(status_code=403, detail="Chat not available")
    if scope.team_ids is not None:
        tid = getattr(conversation, "team_id", None)
        if tid is None or int(tid) not in set(scope.team_ids):
            raise HTTPException(status_code=403, detail="Chat not available")
    return conversation


# ==================== Request/Response Models ====================

class NoteCreate(BaseModel):
    content: str

class NoteUpdate(BaseModel):
    content: str

class NoteResponse(BaseModel):
    id: int
    content: str
    created_at: datetime
    created_by: int
    updated_at: datetime | None
    creator_name: str | None = None  # Will be populated from join

    class Config:
        from_attributes = True


class ConversationMetadataUpdate(BaseModel):
    """Update visitor metadata"""
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None


class PageViewResponse(BaseModel):
    id: int
    title: str | None = None
    url: str
    referrer: str | None = None
    device_info: str | None = None
    browser_info: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== Notes Endpoints ====================

@router.post("/{conversation_id}/notes", response_model=NoteResponse)
def add_note(
    conversation_id: int,
    note: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a private note to a conversation"""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    
    # Create new note
    new_note = ConversationNote(
        conversation_id=conversation_id,
        content=note.content,
        created_by=current_user.id
    )
    db.add(new_note)
    db.commit()
    db.refresh(new_note)
    
    # Add creator name
    result = NoteResponse.from_orm(new_note)
    result.creator_name = current_user.name
    
    return result


@router.get("/{conversation_id}/notes", response_model=List[NoteResponse])
def get_notes(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all notes for a conversation"""
    from app.models.user import User

    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    
    notes = db.query(ConversationNote).filter_by(conversation_id=conversation_id).all()
    
    # Populate creator names
    results = []
    for note in notes:
        creator = db.query(User).filter_by(id=note.created_by).first()
        note_response = NoteResponse.from_orm(note)
        note_response.creator_name = creator.name if creator else "Unknown"
        results.append(note_response)
    
    return results


@router.put("/{conversation_id}/notes/{note_id}", response_model=NoteResponse)
def update_note(
    conversation_id: int,
    note_id: int,
    note_update: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a note (only by creator)"""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    note = db.query(ConversationNote).filter_by(
        id=note_id,
        conversation_id=conversation_id
    ).first()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Only creator can update
    if note.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Can only update your own notes")
    
    note.content = note_update.content
    db.commit()
    db.refresh(note)
    
    result = NoteResponse.from_orm(note)
    result.creator_name = current_user.name
    
    return result


# ==================== Browsing History Endpoints ====================


@router.get("/{conversation_id}/browsing-history", response_model=List[PageViewResponse])
def get_browsing_history(
    conversation_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get recent browsing history (page views) for a conversation."""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    try:
        limit_int = int(limit)
    except Exception:
        limit_int = 50
    limit_int = max(1, min(200, limit_int))

    rows = page_views_repo.list_page_views_for_conversation(db, conversation_id, limit=limit_int)
    return rows


@router.delete("/{conversation_id}/notes/{note_id}")
def delete_note(
    conversation_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a note (only by creator)"""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    note = db.query(ConversationNote).filter_by(
        id=note_id,
        conversation_id=conversation_id
    ).first()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Only creator can delete
    if note.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Can only delete your own notes")
    
    db.delete(note)
    db.commit()
    
    return {"message": "Note deleted"}


# ==================== Visitor Metadata Endpoints ====================

@router.patch("/{conversation_id}/metadata")
def update_conversation_metadata(
    conversation_id: int,
    metadata: ConversationMetadataUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update visitor metadata for a conversation"""
    conversation = _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    
    # Update fields if provided
    if metadata.visitor_name is not None:
        conversation.visitor_name = metadata.visitor_name
    if metadata.visitor_email is not None:
        conversation.visitor_email = metadata.visitor_email
    if metadata.visitor_phone is not None:
        conversation.visitor_phone = metadata.visitor_phone
    
    db.commit()
    
    return {
        "message": "Metadata updated",
        "visitor_name": conversation.visitor_name,
        "visitor_email": conversation.visitor_email,
        "visitor_phone": conversation.visitor_phone
    }
