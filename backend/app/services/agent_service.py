from sqlalchemy.orm import Session
from app.models.agent_session import AgentSession
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.services.connection_manager import mark_connected, mark_disconnected
from app.core.logging import get_logger
from typing import Dict, Optional
import uuid

logger = get_logger(__name__)

class AgentService:
    """Manages agent presence and message routing"""
    
    # In-memory store of active agent WebSocket connections
    active_agents: Dict[str, object] = {}
    
    def __init__(self, db: Session):
        self.db = db
    
    def register_agent(self, agent_id: int, website_id: int, websocket) -> str:
        """Register agent WebSocket connection"""
        websocket_id = str(uuid.uuid4())
        
        # Store WebSocket connection
        AgentService.active_agents[websocket_id] = {
            "agent_id": agent_id,
            "website_id": website_id,
            "websocket": websocket
        }
        
        # Create session record
        session = AgentSession(
            agent_id=agent_id,
            website_id=website_id,
            websocket_id=websocket_id,
            is_online=True
        )
        self.db.add(session)
        self.db.commit()

        # Track connection for availability checks
        mark_connected(agent_id)
        
        return websocket_id
    
    def unregister_agent(self, websocket_id: str):
        """Remove agent from active connections"""
        if websocket_id in AgentService.active_agents:
            del AgentService.active_agents[websocket_id]
        
        # Mark session offline
        session = self.db.query(AgentSession).filter_by(websocket_id=websocket_id).first()
        if session:
            session.is_online = False
            self.db.commit()

        # Update connection tracking
        if session and session.agent_id:
            mark_disconnected(session.agent_id)
    
    def assign_conversation_to_agent(self, conversation_id: int, agent_id: int):
        """Handoff conversation to agent"""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            raise ValueError(f"Conversation {conversation_id} not found")
        
        conversation.is_handoff = True
        conversation.assigned_agent_id = agent_id
        self.db.commit()
        self.db.refresh(conversation)
        
        return conversation
    
    async def send_to_agent(self, agent_id: int, message_data: dict):
        """Send message to specific agent's WebSocket"""
        logger.info("send_to_agent_attempt", agent_id=agent_id, message_type=message_data.get("type"))
        sent_count = 0
        for ws_id, agent_info in AgentService.active_agents.items():
            if agent_info["agent_id"] == agent_id:
                try:
                    await agent_info["websocket"].send_json(message_data)
                    sent_count += 1
                    logger.info("send_to_agent_success", agent_id=agent_id, ws_id=ws_id, website_id=agent_info.get("website_id"))
                except Exception as e:
                    logger.error("send_to_agent_failed", agent_id=agent_id, ws_id=ws_id, error=str(e))
        
        if sent_count == 0:
            logger.warning("send_to_agent_no_connections", agent_id=agent_id, message_type=message_data.get("type"))
    
    async def notify_agent_assignment(self, agent_id: int, conversation_id: int):
        """Notify agent of new chat assignment"""
        await self.send_to_agent(agent_id, {
            "type": "assignment",
            "conversation_id": conversation_id,
            "message": "New chat assigned to you"
        })
    
    def get_active_chats(self, website_id: Optional[int] = None, agent_id: Optional[int] = None):
        """
        Get list of OPEN conversations visible to agents.
        
        Inbox Visibility Rules:
        - Unassigned: Visible to all eligible agents
        - Assigned: Only visible to assigned agent
        
        Args:
            website_id: Optional filter by website
            agent_id: Optional filter by assigned agent
            
        Returns:
            List of conversations
        """
        # Base query: get all OPEN conversations
        query = self.db.query(Conversation).filter(
            Conversation.status == ConversationStatus.OPEN
        )
        
        # If agent_id provided, filter for:
        # 1. Unassigned (available to claim)
        # 2. Assigned to this agent
        if agent_id:
            query = query.filter(
                (Conversation.assigned_agent_id == None) |
                (Conversation.assigned_agent_id == agent_id)
            )
        
        if website_id:
            query = query.filter(Conversation.website_id == website_id)
        
        return query.all()
    
    def get_conversation_messages(self, conversation_id: int):
        """Get all messages in a conversation"""
        return self.db.query(Message).filter_by(
            conversation_id=conversation_id
        ).order_by(Message.created_at).all()
