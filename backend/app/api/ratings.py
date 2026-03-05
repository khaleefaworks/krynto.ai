"""Conversation Rating API.

Allows:
 - Visitors to submit ratings via WebSocket (see ws_chat.py handler)
 - Dashboard agents to view ratings on conversations
 - REST fallback for rating submission (widget HTTP POST)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.conversation import Conversation
from app.models.conversation_rating import ConversationRating
from app.api.deps import get_current_user

logger = get_logger(__name__)

router = APIRouter(prefix="/ratings", tags=["ratings"])


class RatingSubmitRequest(BaseModel):
    conversation_id: int
    rating: int = Field(..., ge=-1, le=1)  # -1=bad, 0=neutral, 1=good
    feedback: str | None = None
    session_id: str | None = None


class RatingResponse(BaseModel):
    id: int
    conversation_id: int
    rating: int
    feedback: str | None
    created_at: str | None

    class Config:
        from_attributes = True


@router.get("/{conversation_id}")
def get_rating(
    conversation_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Get rating for a conversation (dashboard use)."""
    rating = (
        db.query(ConversationRating)
        .filter(ConversationRating.conversation_id == conversation_id)
        .first()
    )
    if not rating:
        return {"rating": None}
    return {
        "rating": {
            "id": rating.id,
            "conversation_id": rating.conversation_id,
            "rating": rating.rating,
            "feedback": rating.feedback,
            "created_at": str(rating.created_at) if rating.created_at else None,
        }
    }


@router.post("/submit")
def submit_rating_http(
    body: RatingSubmitRequest,
    db: Session = Depends(get_db),
):
    """HTTP POST fallback for rating submission (no auth — visitor endpoint).

    The widget primarily submits via WebSocket, but this is a fallback
    for when the socket has already closed (e.g. agent resolved while
    visitor had the tab open).
    """
    conversation = db.query(Conversation).filter_by(id=body.conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check session_id matches for basic validation
    if body.session_id and conversation.session_id != body.session_id:
        raise HTTPException(status_code=403, detail="Session mismatch")

    # Upsert: one rating per conversation
    existing = (
        db.query(ConversationRating)
        .filter(ConversationRating.conversation_id == body.conversation_id)
        .first()
    )
    if existing:
        existing.rating = body.rating
        existing.feedback = body.feedback
        db.commit()
        return {"status": "updated", "id": existing.id}

    rating = ConversationRating(
        conversation_id=body.conversation_id,
        rating=body.rating,
        feedback=body.feedback,
        session_id=body.session_id,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    logger.info("rating_submitted", conversation_id=body.conversation_id, rating=body.rating)
    return {"status": "created", "id": rating.id}
