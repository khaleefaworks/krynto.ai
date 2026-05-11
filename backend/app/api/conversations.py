"""
Conversations API - Conversation management endpoints

Handles:
- Claiming conversations (FCFS atomic)
- Conversation lifecycle operations
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.deps import require_authenticated_user, require_admin, require_agent
from app.models.user import User
from app.models.conversation import Conversation
from app.models.website_team import WebsiteTeam
from app.services.conversation_service import ConversationService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.agent_service import AgentService
from app.services.visibility import compute_visibility_scope
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _ensure_visible(db: Session, *, current_user: User, conversation_id: int) -> Conversation:
    conv = db.query(Conversation).filter(Conversation.id == int(conversation_id)).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and int(conv.website_id) not in set(scope.website_ids):
        raise HTTPException(status_code=403, detail="Chat not available")
    if scope.team_ids is not None:
        tid = getattr(conv, "team_id", None)
        if tid is None or int(tid) not in set(scope.team_ids):
            raise HTTPException(status_code=403, detail="Chat not available")

    return conv


class ClaimResponse(BaseModel):
    success: bool
    message: str
    conversation_id: int


class TagActionRequest(BaseModel):
    tag_id: int


class SetTeamRequest(BaseModel):
    team_id: Optional[int] = None


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
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
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
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
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
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
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
        "agent_is_available": result.get("agent_is_available"),
        "availability_changed": result.get("availability_changed"),
    }


@router.post("/{conversation_id}/tags")
def tag_conversation(
    conversation_id: int,
    payload: TagActionRequest,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """Add a tag to a conversation"""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
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
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)
    conversation_service = ConversationService(db)
    success = conversation_service.untag_conversation(
        conversation_id=conversation_id,
        tag_id=tag_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found on conversation")
    return {"success": True}


@router.put("/{conversation_id}/team")
async def set_conversation_team(
    conversation_id: int,
    payload: SetTeamRequest,
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Assign (or clear) a single website team for a conversation.

    Agents and admins can assign teams to conversations they can access.
    Team CRUD (create/edit/delete) remains admin-only via website_teams endpoints.
    """
    conv = _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    # Clear team assignment
    if payload.team_id is None:
        conv.team_id = None
        db.commit()
        await _broadcast_team_changed(db, conversation_id, int(conv.website_id), None)
        return {"success": True, "conversation_id": conversation_id, "team_id": None}

    team_id = int(payload.team_id)
    team = db.query(WebsiteTeam).filter(WebsiteTeam.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if int(getattr(team, "website_id", 0)) != int(getattr(conv, "website_id", 0)):
        raise HTTPException(status_code=400, detail="Team does not belong to this website")

    conv.team_id = team.id
    db.commit()
    await _broadcast_team_changed(db, conversation_id, int(conv.website_id), team.id)
    return {"success": True, "conversation_id": conversation_id, "team_id": team.id}


async def _broadcast_team_changed(
    db: Session,
    conversation_id: int,
    website_id: int,
    team_id: int | None,
) -> None:
    """Notify active agent sockets so they can refresh their chat lists."""
    try:
        agent_service = AgentService(db)
        await agent_service.broadcast_to_active_agents(
            website_id=website_id,
            message_data={
                "type": "conversation_team_changed",
                "conversation_id": conversation_id,
                "website_id": website_id,
                "team_id": team_id,
            },
            include_global=True,
        )
    except Exception:
        pass  # Best-effort; the manager's own UI updates optimistically
