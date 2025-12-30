from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.agent_service import AgentService
from app.services.conversation_service import ConversationService
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/chats", tags=["chats"])


class JoinChatRequest(BaseModel):
    agent_id: int


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
    request: JoinChatRequest,
    db: Session = Depends(get_db)
):
    """Agent joins a chat - triggers handoff"""
    agent_service = AgentService(db)
    
    try:
        conversation = agent_service.assign_conversation_to_agent(
            chat_id, request.agent_id
        )
        
        # Don't notify here - WebSocket will handle it when agent connects
        # The agent WebSocket sends "join_chat" message after connecting
        
        return {
            "success": True,
            "conversation_id": conversation.id,
            "website_id": conversation.website_id,
            "assigned_agent_id": conversation.assigned_agent_id,
            "message": "Chat successfully assigned to agent"
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to join chat: {str(e)}")


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
    
    return [
        {
            "id": msg.id,
            "conversation_id": msg.conversation_id,
            "sender": msg.sender,
            "content": msg.content,
            "created_at": msg.created_at.isoformat() if msg.created_at else None
        }
        for msg in messages
    ]


@router.post("/{chat_id}/close")
def close_conversation(
    chat_id: int,
    db: Session = Depends(get_db)
):
    """Close a conversation - marks it as completed"""
    from app.models.conversation import Conversation
    
    conv = db.query(Conversation).filter_by(id=chat_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conv.status == "closed":
        return {
            "success": True,
            "message": "Conversation already closed"
        }
    
    conv.status = "closed"
    db.commit()
    
    return {
        "success": True,
        "message": "Conversation closed successfully"
    }


@router.get("/closed/history")
def get_closed_conversations(
    website_id: Optional[int] = None,
    agent_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Get closed conversation history with filters"""
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.website import Website
    
    query = db.query(Conversation).filter(Conversation.status == "closed")
    
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
    Close a conversation.
    
    Transitions conversation to CLOSED state.
    No more messages can be added after closing.
    """
    conversation_service = ConversationService(db)
    
    success = conversation_service.close_conversation(conversation_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "success": True,
        "conversation_id": conversation_id,
        "message": "Conversation closed successfully"
    }
