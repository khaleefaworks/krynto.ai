from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.agent_service import AgentService
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
    
    agent_service = AgentService(db)
    conversations = agent_service.get_active_chats(website_id)
    
    # Add message count to each conversation
    result = []
    for conv in conversations:
        msg_count = db.query(Message).filter_by(conversation_id=conv.id).count()
        result.append({
            "id": conv.id,
            "website_id": conv.website_id,
            "session_id": conv.session_id,
            "status": conv.status,
            "is_handoff": conv.is_handoff if conv.is_handoff is not None else False,
            "assigned_agent_id": conv.assigned_agent_id,
            "message_count": msg_count
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
