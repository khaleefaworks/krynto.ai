from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus, ConversationMode
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
        
        - OFFLINE: Store message, return None (no AI response)
        - ACTIVE with agent: Forward to agent
        - ACTIVE without agent: Queue for agent
        - CLOSED: Reject message
        """
        conversation_service = ConversationService(self.db)
        
        # Check if conversation is closed
        if self.conversation.status == ConversationStatus.CLOSED:
            logger.warning("message_rejected_closed", conversation_id=self.conversation.id)
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
        
        # OFFLINE mode: just store message, no response
        if self.conversation.status == ConversationStatus.OFFLINE:
            logger.info("offline_message_stored", conversation_id=self.conversation.id)
            return None  # System message already sent during conversation creation
        
        # MODE-BASED ROUTING
        if self.conversation.mode == ConversationMode.AGENT_HANDLING:
            logger.info("agent_handling_mode", conversation_id=self.conversation.id, assigned_agent_id=self.conversation.assigned_agent_id)
            
            # Forward message to agent
            from app.services.agent_service import AgentService
            agent_service = AgentService(self.db)
            
            if self.conversation.assigned_agent_id:
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
        
        if self.conversation.mode == ConversationMode.WAITING_FOR_AGENT:
            logger.info("waiting_for_agent_mode", conversation_id=self.conversation.id)
            # Message stored, waiting for agent to claim
            return "Thanks! An agent will be with you shortly."
        
        # Shouldn't reach here, but handle gracefully
        logger.warning("unexpected_mode", conversation_id=self.conversation.id, mode=self.conversation.mode.value)
        return "Your message has been received. An agent will respond soon."
    
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

