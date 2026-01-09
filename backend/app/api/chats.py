from fastapi import APIRouter, Depends, HTTPException
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.conversation_service import ConversationService
from app.api.deps import require_authenticated_user
from app.models.user import User
from pydantic import BaseModel
from typing import List, Optional

from app.api.message_presenter import serialize_message
from app.repos import conversations as conversations_repo

router = APIRouter(prefix="/chats", tags=["chats"])


class ConversationResponse(BaseModel):
    id: int
    website_id: int
    session_id: str
    status: str
    is_handoff: bool
    assigned_agent_id: Optional[int]
    message_count: int
    
    class Config:
        from_attributes = True


@router.post("/{chat_id}/join")
async def join_chat(
    chat_id: int,
    _request: Optional[dict] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Agent joins a chat - triggers handoff"""
    from app.models.conversation import Conversation
    
    orchestrator = ConversationOrchestrator(db)

    result = await orchestrator.handle_agent_join(
        conversation_id=chat_id,
        agent_id=current_user.id,
    )

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    conversation = conversations_repo.get_conversation_by_id(db, chat_id)

    return {
        "success": True,
        "conversation_id": chat_id,
        "website_id": conversation.website_id if conversation else None,
        "assigned_agent_id": current_user.id,
        "message": "Chat successfully assigned to agent",
    }


@router.get("/active")
def get_active_chats(
    website_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get list of active chats available for agent pickup"""
    # Match AgentService.get_active_chats() base visibility rules (without agent_id filter).
    rows = conversations_repo.active_conversations_with_counts_and_last_message(db, website_id=website_id)

    result = []
    for conv, website_name, message_count, last_message in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages yet"
        result.append(
            {
                "id": conv.id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
                "is_handoff": conv.is_handoff if conv.is_handoff is not None else False,
                "assigned_agent_id": conv.assigned_agent_id,
                "message_count": int(message_count or 0),
                "last_message": last_message_val,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
            }
        )

    return result


@router.get("/{chat_id}/messages")
def get_chat_messages(
    chat_id: int,
    db: Session = Depends(get_db)
):
    """Get all messages in a conversation"""
    agent_service = AgentService(db)
    messages = agent_service.get_conversation_messages(chat_id)
    
    if not messages:
        # Check if conversation exists
        conv = conversations_repo.get_conversation_by_id(db, chat_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        # Return empty array if conversation exists but no messages
        return []
    
    result = []
    for msg in messages:
        result.append(serialize_message(db, msg))

    return result


@router.get("/resolved/history")
def get_resolved_conversations(
    website_id: Optional[int] = None,
    agent_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Get resolved conversation history with filters"""
    rows = conversations_repo.resolved_conversations_with_counts_and_last_message(
        db,
        website_id=website_id,
        agent_id=agent_id,
        limit=limit,
    )

    result = []
    for conv, website_name, message_count, last_message in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages"
        result.append(
            {
                "id": conv.id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "status": conv.status,
                "assigned_agent_id": conv.assigned_agent_id,
                "message_count": int(message_count or 0),
                "last_message": last_message_val,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "closed_at": conv.updated_at.isoformat() if conv.updated_at else None,
            }
        )

    return result


@router.post("/{conversation_id}/close")
async def close_conversation(
    conversation_id: int,
    db: Session = Depends(get_db)
):
    """
    Resolve a conversation.
    
    Transitions conversation to RESOLVED state.
    No more messages can be added after resolving.
    """
    orchestrator = ConversationOrchestrator(db)

    result = await orchestrator.close_conversation(conversation_id=conversation_id)

    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])

    return {
        "success": True,
        "conversation_id": conversation_id,
        "message": "Conversation resolved successfully",
    }
