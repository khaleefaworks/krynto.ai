from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.services.conversation_service import ConversationService
from app.core.logging import get_logger
from typing import Dict, Optional

logger = get_logger(__name__)


class ChatService:
    # Track active visitor WebSocket connections
    active_visitors: Dict[int, object] = {}
    
    def __init__(self, db: Session, website_id: int, session_id: str, websocket=None):
        self.db = db
        self.website_id = website_id
        self.session_id = session_id
        self.websocket = websocket

        # Use ConversationService for lifecycle management
        conversation_service = ConversationService(db)
        self.conversation = conversation_service.get_or_create_conversation(
            website_id=website_id,
            session_id=session_id
        )
        
        # Register visitor WebSocket
        if websocket:
            ChatService.active_visitors[self.conversation.id] = websocket

    async def handle_visitor_message(self, text: str) -> Optional[str]:
        """
        Handle visitor message based on conversation status.
        
        - OPEN with agent: Forward to agent
        - OPEN without agent: Queue for agent
        - RESOLVED: Reject message
        """
        conversation_service = ConversationService(self.db)
        
        # Check if conversation is resolved
        if self.conversation.status == ConversationStatus.RESOLVED:
            logger.warning("message_rejected_resolved", conversation_id=self.conversation.id)
            return "This conversation has been closed."
        
        # Save visitor message
        message = conversation_service.add_visitor_message(
            conversation_id=self.conversation.id,
            content=text
        )
        
        if not message:
            return "Unable to send message at this time."
        
        # Refresh conversation to get latest state
        self.db.refresh(self.conversation)
        
        # If agent assigned, forward message
        if self.conversation.assigned_agent_id:
            logger.info("forwarding_to_agent", conversation_id=self.conversation.id, assigned_agent_id=self.conversation.assigned_agent_id)
            
            # Forward message to agent
            from app.services.agent_service import AgentService
            agent_service = AgentService(self.db)
            
            await agent_service.send_to_agent(
                self.conversation.assigned_agent_id,
                {
                    "type": "visitor_message",
                    "conversation_id": self.conversation.id,
                    "message": text
                }
            )
            
            # Return None - agent will respond
            return None
        
        # No agent assigned yet
        logger.info("waiting_for_agent", conversation_id=self.conversation.id)
        return "Thanks! An agent will be with you shortly."
    
    async def send_to_visitor(self, message_data: dict):
        """Send message to visitor's WebSocket"""
        if self.conversation.id in ChatService.active_visitors:
            websocket = ChatService.active_visitors[self.conversation.id]
            await websocket.send_json(message_data)
    
    @staticmethod
    def get_by_conversation_id(db: Session, conversation_id: int):
        """Get ChatService instance for existing conversation"""
        conversation = db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return None
        
        # Create service without WebSocket (will use active_visitors registry)
        service = ChatService.__new__(ChatService)
        service.db = db
        service.conversation = conversation
        return service

    def close_session(self):
        # Remove from active visitors
        if self.conversation.id in ChatService.active_visitors:
            del ChatService.active_visitors[self.conversation.id]

