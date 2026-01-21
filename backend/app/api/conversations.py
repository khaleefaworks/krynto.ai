"""
Conversations API - Conversation management endpoints

Handles:
- Claiming conversations (FCFS atomic)
- Conversation lifecycle operations
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.deps import require_authenticated_user
from app.models.user import User
from app.models.conversation import Conversation
from app.services.conversation_service import ConversationService
from app.services.conversation_orchestrator import ConversationOrchestrator
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ClaimResponse(BaseModel):
    success: bool
    message: str
    conversation_id: int


class TagActionRequest(BaseModel):
    tag_id: int


@router.post("/{conversation_id}/claim", response_model=ClaimResponse)
def claim_conversation(
    conversation_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Claim a conversation atomically (FCFS).
    
    Rules:
    - Only OPEN + unassigned conversations can be claimed
    - Only one agent can claim (DB-enforced)
    - First successful UPDATE wins
    - Losers get 409 Conflict
    
    This is the CRITICAL endpoint that prevents race conditions.
    """
    conversation_service = ConversationService(db)
    
    success, message = conversation_service.claim_conversation(
        conversation_id=conversation_id,
        agent_id=current_user.id,
        agent_name=current_user.name or current_user.email.split("@")[0]
    )
    
    if not success:
        raise HTTPException(status_code=409, detail=message)
    
    return ClaimResponse(
        success=True,
        message=message,
        conversation_id=conversation_id
    )


@router.get("/{conversation_id}/can_message")
def check_can_message(
    conversation_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Check if current agent can send messages to conversation.
    
    Returns permission status and reason.
    """
    conversation_service = ConversationService(db)
    
    allowed, reason = conversation_service.can_agent_message(
        conversation_id=conversation_id,
        agent_id=current_user.id
    )
    
    return {
        "allowed": allowed,
        "reason": reason,
        "conversation_id": conversation_id
    }


@router.post("/{conversation_id}/takeover")
async def takeover_conversation(
    conversation_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Force-assign a conversation to the current agent (explicit confirmation flow)."""
    orchestrator = ConversationOrchestrator(db)

    result = await orchestrator.handle_agent_takeover(
        conversation_id=conversation_id,
        agent_id=current_user.id,
    )

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return {
        "success": True,
        "conversation_id": conversation_id,
        "message_obj": result.get("message_obj"),
        "message_id": result.get("message_id"),
    }


@router.post("/{conversation_id}/tags")
def tag_conversation(
    conversation_id: int,
    payload: TagActionRequest,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Add a tag to a conversation"""
    conversation_service = ConversationService(db)
    success = conversation_service.tag_conversation(
        conversation_id=conversation_id,
        tag_id=payload.tag_id,
        agent_id=current_user.id
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to add tag")
    return {"success": True}


@router.delete("/{conversation_id}/tags/{tag_id}")
def untag_conversation(
    conversation_id: int,
    tag_id: int,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Remove a tag from a conversation"""
    conversation_service = ConversationService(db)
    success = conversation_service.untag_conversation(
        conversation_id=conversation_id,
        tag_id=tag_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found on conversation")
    return {"success": True}
