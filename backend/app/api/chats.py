from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.conversation_service import ConversationService
from app.api.deps import require_authenticated_user
from app.models.user import User
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/chats", tags=["chats"])


def _resolve_sender_user(db: Session, sender: Optional[str]) -> Optional[User]:
    if not sender:
        return None

    # Newer messages may store agent_id as a string in sender.
    try:
        user_id = int(str(sender))
        return db.query(User).filter(User.id == user_id).first()
    except Exception:
        pass

    # Backwards-compat: older messages might store agent email.
    try:
        return db.query(User).filter(User.email == str(sender)).first()
    except Exception:
        return None


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

    conversation = db.query(Conversation).filter_by(id=chat_id).first()

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
    from app.models.message import Message
    from app.models.website import Website
    
    agent_service = AgentService(db)
    conversations = agent_service.get_active_chats(website_id)
    
    # Add message count and additional info to each conversation
    result = []
    for conv in conversations:
        # Get message count and last message
        messages = db.query(Message).filter_by(conversation_id=conv.id).order_by(Message.created_at.desc()).all()
        msg_count = len(messages)
        last_message = messages[0].content if messages else "No messages yet"
        
        # Get website name
        website = db.query(Website).filter_by(id=conv.website_id).first()
        website_name = website.name if website else f"Website {conv.website_id}"
        
        result.append({
            "id": conv.id,
            "website_id": conv.website_id,
            "website_name": website_name,
            "session_id": conv.session_id,
            "status": conv.status.value if hasattr(conv.status, 'value') else conv.status,
            "is_handoff": conv.is_handoff if conv.is_handoff is not None else False,
            "assigned_agent_id": conv.assigned_agent_id,
            "message_count": msg_count,
            "last_message": last_message,
            "created_at": conv.created_at.isoformat() if conv.created_at else None
        })
    
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
        from app.models.conversation import Conversation
        conv = db.query(Conversation).filter_by(id=chat_id).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        # Return empty array if conversation exists but no messages
        return []
    
    result = []
    for msg in messages:
        sender_type = msg.sender_type.value if hasattr(msg.sender_type, 'value') else msg.sender_type
        event_type = getattr(msg, "event_type", None)

        sender_name = None
        sender_avatar_url = None

        if sender_type == "agent":
            u = _resolve_sender_user(db, msg.sender)
            if u:
                sender_name = u.name or u.email
                sender_avatar_url = u.avatar_url
        elif sender_type == "system":
            # Bot/automation messages should render with a robot avatar client-side.
            if msg.sender == "bot" or (event_type and str(event_type).startswith("automation")) or event_type == "bot":
                sender_name = "AI"

        result.append(
            {
                "id": msg.id,
                "conversation_id": msg.conversation_id,
                "sender": msg.sender,
                "sender_type": sender_type,
                "event_type": event_type,
                "sender_name": sender_name,
                "sender_avatar_url": sender_avatar_url,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            }
        )

    return result


@router.get("/resolved/history")
def get_resolved_conversations(
    website_id: Optional[int] = None,
    agent_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Get resolved conversation history with filters"""
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.message import Message
    from app.models.website import Website
    
    query = db.query(Conversation).filter(Conversation.status == ConversationStatus.RESOLVED)
    
    if website_id:
        query = query.filter(Conversation.website_id == website_id)
    
    if agent_id:
        query = query.filter(Conversation.assigned_agent_id == agent_id)
    
    conversations = query.order_by(Conversation.updated_at.desc()).limit(limit).all()
    
    result = []
    for conv in conversations:
        # Get message count and last message
        messages = db.query(Message).filter_by(conversation_id=conv.id).order_by(Message.created_at.desc()).all()
        msg_count = len(messages)
        last_message = messages[0].content if messages else "No messages"
        
        # Get website name
        website = db.query(Website).filter_by(id=conv.website_id).first()
        website_name = website.name if website else f"Website {conv.website_id}"
        
        result.append({
            "id": conv.id,
            "website_id": conv.website_id,
            "website_name": website_name,
            "session_id": conv.session_id,
            "status": conv.status,
            "assigned_agent_id": conv.assigned_agent_id,
            "message_count": msg_count,
            "last_message": last_message,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
            "closed_at": conv.updated_at.isoformat() if conv.updated_at else None
        })
    
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
