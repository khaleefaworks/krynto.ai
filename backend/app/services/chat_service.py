from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.models.website import Website
from app.services.ai_service import generate_ai_response
from app.services.conversation_service import ConversationService
from app.core.logging import get_logger
from typing import Dict, Optional

logger = get_logger(__name__)

# Confidence threshold for triggering agent handoff
AI_CONFIDENCE_THRESHOLD = 0.4


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
        - ACTIVE with handoff: Forward to agent
        - ACTIVE without handoff: AI response
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
        
        # ⚠️ PHASE 3 HANDOFF LOGIC - AI PAUSE
        if self.conversation.is_handoff:
            logger.info("ai_paused_handoff_active", conversation_id=self.conversation.id, assigned_agent_id=self.conversation.assigned_agent_id)
            
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
        
        # Get website for AI instructions
        website = self.db.query(Website).filter_by(id=self.conversation.website_id).first()
        
        # Try to generate AI response - gracefully handle failures
        try:
            # Generate AI response using RAG
            ai_result = generate_ai_response(
                website_id=self.conversation.website_id,
                website_instructions=website.ai_instructions if website else "",
                user_message=text,
            )
            
            # Check confidence and trigger handoff if needed
            if ai_result["confidence"] < AI_CONFIDENCE_THRESHOLD:
                logger.warning("low_confidence_triggering_handoff", conversation_id=self.conversation.id, confidence=ai_result["confidence"], threshold=AI_CONFIDENCE_THRESHOLD)
                
                # Mark conversation for handoff
                self.conversation.is_handoff = True
                self.db.commit()
                
                # Save handoff message
                handoff_message = "I'm not confident I can answer that accurately. Let me connect you with a human agent who can help better."
                self.db.add(Message(
                    conversation_id=self.conversation.id,
                    sender_type=MessageSenderType.SYSTEM,
                    sender="ai",
                    content=handoff_message
                ))
                self.db.commit()
                
                # Notify agent service (will be handled by agent dashboard)
                from app.services.agent_service import AgentService
                agent_service = AgentService(self.db)
                
                return handoff_message

            # Save AI message with confidence
            ai_reply = ai_result["answer"]
            self.db.add(Message(
                conversation_id=self.conversation.id,
                sender_type=MessageSenderType.AGENT,  # AI uses AGENT type for now
                sender="ai",
                content=ai_reply
            ))
            self.db.commit()

            return ai_reply
            
        except Exception as e:
            # AI failed (API key, network, etc.) - trigger handoff to agent
            logger.error("ai_error_triggering_handoff", conversation_id=self.conversation.id, error=str(e), exc_info=True)
            
            # Mark conversation for handoff
            self.conversation.is_handoff = True
            self.db.commit()
            
            # Save handoff message
            handoff_message = "I'm having trouble processing your request. Let me connect you with a human agent who can help."
            self.db.add(Message(
                conversation_id=self.conversation.id,
                sender_type=MessageSenderType.SYSTEM,
                sender="ai",
                content=handoff_message
            ))
            self.db.commit()
            
            return handoff_message
    
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

