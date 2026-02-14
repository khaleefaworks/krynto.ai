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

from app.core.message_presenter import serialize_message
from app.repos import conversations as conversations_repo
from app.repos import conversation_reads as conversation_reads_repo
from app.models.message import Message, MessageSenderType

router = APIRouter(prefix="/chats", tags=["chats"])


def _safe_serialize_conversation_tags(conv) -> list[dict]:
    """Best-effort tag serialization.

    This endpoint is used by the agent dashboard. If the DB schema is
    temporarily out of sync (e.g. tag refactor in progress), we prefer to
    return an empty list rather than raising and causing a 500.
    """

    try:
        conv_tags = getattr(conv, "tags", None)
        if not conv_tags:
            return []

        result: list[dict] = []
        for ct in conv_tags:
            tag = getattr(ct, "tag", None)
            if not tag:
                continue
            result.append(
                {
                    "id": tag.id,
                    "name": tag.name,
                    "color": tag.color,
                }
            )
        return result
    except Exception:
        return []


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
        "message_obj": result.get("message_obj"),
        "message_id": result.get("message_id"),
    }


@router.get("/active")
def get_active_chats(
    website_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Get list of active chats available for agent pickup"""
    # Match AgentService.get_active_chats() base visibility rules (without agent_id filter).
    rows = conversations_repo.active_conversations_with_counts_and_last_message(db, website_id=website_id)

    conversation_ids: list[int] = [int(conv.id) for conv, *_rest in rows]
    unread_counts = conversation_reads_repo.unread_counts_for_conversation_ids(
        db, user_id=current_user.id, conversation_ids=conversation_ids
    )

    result = []
    for conv, website_name, message_count, last_message, last_message_at in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages yet"
        result.append(
            {
                "id": conv.id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "visitor_name": conv.visitor_name,
                "visitor_email": conv.visitor_email,
                "visitor_phone": conv.visitor_phone,
                "device_info": conv.device_info,
                "browser_info": conv.browser_info,
                "visit_count": int(conv.visit_count or 0) if hasattr(conv, "visit_count") else None,
                "last_seen_at": conv.last_seen_at.isoformat() if getattr(conv, "last_seen_at", None) else None,
                "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
                "is_handoff": conv.is_handoff if conv.is_handoff is not None else False,
                "assigned_agent_id": conv.assigned_agent_id,
                "message_count": int(message_count or 0),
                "unread_count": int(unread_counts.get(int(conv.id), 0)),
                "last_message": last_message_val,
                "last_message_at": last_message_at.isoformat() if last_message_at else None,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "tags": _safe_serialize_conversation_tags(conv),
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
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
):
    """Get resolved conversation history with filters"""
    rows = conversations_repo.resolved_conversations_with_counts_and_last_message(
        db,
        website_id=website_id,
        agent_id=agent_id,
        limit=limit,
    )

    result = []
    for conv, website_name, message_count, last_message, last_message_at in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages"
        result.append(
            {
                "id": conv.id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "visitor_name": conv.visitor_name,
                "visitor_email": conv.visitor_email,
                "visitor_phone": conv.visitor_phone,
                "device_info": conv.device_info,
                "browser_info": conv.browser_info,
                "visit_count": int(conv.visit_count or 0) if hasattr(conv, "visit_count") else None,
                "last_seen_at": conv.last_seen_at.isoformat() if getattr(conv, "last_seen_at", None) else None,
                "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
                "assigned_agent_id": conv.assigned_agent_id,
                "message_count": int(message_count or 0),
                "unread_count": 0,
                "last_message": last_message_val,
                "last_message_at": last_message_at.isoformat() if last_message_at else None,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "closed_at": conv.updated_at.isoformat() if conv.updated_at else None,
                "tags": _safe_serialize_conversation_tags(conv),
            }
        )

    return result


@router.post("/{conversation_id}/close")
async def close_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
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


@router.post("/{chat_id}/read")
async def mark_chat_read(
    chat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Mark a chat as read for the current user."""

    conv = conversations_repo.get_conversation_by_id(db, chat_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conversation_reads_repo.mark_conversation_read(
        db,
        conversation_id=chat_id,
        user_id=current_user.id,
    )
    db.commit()

    # Best-effort: tell the agent UI (and any other tabs) to clear unread.
    try:
        await AgentService(db).send_to_agent(
            current_user.id,
            {
                "type": "conversation_unread",
                "conversation_id": chat_id,
                "website_id": conv.website_id,
                "unread_count": 0,
            },
        )
    except Exception:
        pass

    return {"success": True, "conversation_id": chat_id}


@router.get("/{chat_id}/read-state")
def get_chat_read_state(
    chat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Return read state for placing an unread separator in the thread UI."""

    conv = conversations_repo.get_conversation_by_id(db, chat_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        from app.models.conversation_read import ConversationRead

        row = (
            db.query(ConversationRead)
            .filter(ConversationRead.conversation_id == chat_id, ConversationRead.user_id == current_user.id)
            .first()
        )
        last_read_at = row.last_read_at if row else None
    except Exception:
        last_read_at = None

    # Find the earliest unread VISITOR message after last_read_at.
    first_unread_message_id = None
    try:
        q = db.query(Message).filter(Message.conversation_id == chat_id, Message.sender_type == MessageSenderType.VISITOR)
        if last_read_at is not None:
            q = q.filter(Message.created_at > last_read_at)
        first_unread = q.order_by(Message.created_at.asc(), Message.id.asc()).first()
        first_unread_message_id = int(first_unread.id) if first_unread else None
    except Exception:
        first_unread_message_id = None

    return {
        "conversation_id": chat_id,
        "last_read_at": last_read_at.isoformat() if last_read_at else None,
        "first_unread_message_id": first_unread_message_id,
    }
