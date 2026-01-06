from sqlalchemy.orm import Session
from app.models.conversation import Conversation
from typing import Dict

from app.core.logging import get_logger

logger = get_logger(__name__)


class ChatService:
    """
    Simplified service for managing visitor WebSocket connections.
    Only handles visitor socket registration and message delivery.
    All business logic is in ConversationOrchestrator.
    """
    
    # Track active visitor WebSocket connections
    # Key: conversation_id, Value: WebSocket object
    active_visitors: Dict[int, object] = {}
    
    @staticmethod
    async def send_to_visitor(conversation_id: int, message_data: dict):
        """Send message to visitor's WebSocket if they're connected"""
        if conversation_id in ChatService.active_visitors:
            websocket = ChatService.active_visitors[conversation_id]
            try:
                await websocket.send_json(message_data)
                logger.info("message_sent_to_visitor", conversation_id=conversation_id, message_type=message_data.get("type"))
            except Exception as e:
                logger.error("failed_to_send_to_visitor", conversation_id=conversation_id, error=str(e))
        else:
            logger.warning("visitor_not_connected", conversation_id=conversation_id)
    
    @staticmethod
    def register_visitor(conversation_id: int, websocket):
        """Register a visitor's WebSocket connection"""
        ChatService.active_visitors[conversation_id] = websocket
        logger.info("visitor_registered", conversation_id=conversation_id)
    
    @staticmethod
    def unregister_visitor(conversation_id: int):
        """Remove a visitor's WebSocket connection"""
        if conversation_id in ChatService.active_visitors:
            del ChatService.active_visitors[conversation_id]
            logger.info("visitor_unregistered", conversation_id=conversation_id)
    
    @staticmethod
    def get_by_conversation_id(db: Session, conversation_id: int):
        """
        Get a ChatService-like object for sending messages.
        This is a compatibility method for existing code.
        """
        conversation = db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return None
        
        # Create a simple object with send_to_visitor method
        class ChatServiceProxy:
            def __init__(self, conv_id):
                self.conversation_id = conv_id
                self.conversation = conversation
            
            async def send_to_visitor(self, message_data: dict):
                await ChatService.send_to_visitor(self.conversation_id, message_data)
        
        return ChatServiceProxy(conversation_id)

