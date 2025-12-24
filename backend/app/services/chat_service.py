from sqlalchemy.orm import Session
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.ai_service import AIService
from typing import Dict, Optional


class ChatService:
    # Track active visitor WebSocket connections
    active_visitors: Dict[int, object] = {}
    
    def __init__(self, db: Session, website_id: int, session_id: str, websocket=None):
        self.db = db
        self.website_id = website_id
        self.session_id = session_id
        self.ai = AIService()
        self.websocket = websocket

        self.conversation = self._get_or_create_conversation()
        
        # Register visitor WebSocket
        if websocket:
            ChatService.active_visitors[self.conversation.id] = websocket

    def _get_or_create_conversation(self):
        convo = (
            self.db.query(Conversation)
            .filter_by(session_id=self.session_id)
            .first()
        )

        if not convo:
            convo = Conversation(
                website_id=self.website_id,
                session_id=self.session_id,
                status="ai",
                is_handoff=False
            )
            self.db.add(convo)
            self.db.commit()
            self.db.refresh(convo)

        return convo

    async def handle_visitor_message(self, text: str) -> Optional[str]:
        # Save visitor message
        self.db.add(Message(
            conversation_id=self.conversation.id,
            sender="visitor",
            content=text
        ))
        self.db.commit()
        
        # Refresh conversation to get latest state
        self.db.refresh(self.conversation)
        
        # ⚠️ PHASE 3 HANDOFF LOGIC - AI PAUSE
        if self.conversation.is_handoff:
            print(f"🛑 AI paused - conversation {self.conversation.id} is with agent")
            
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
        
        # AI response (only if not handed off)
        ai_reply = await self.ai.respond(text)

        # Save AI message
        self.db.add(Message(
            conversation_id=self.conversation.id,
            sender="ai",
            content=ai_reply
        ))
        self.db.commit()

        return ai_reply
    
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
        service.ai = AIService()
        return service

    def close_session(self):
        # Remove from active visitors
        if self.conversation.id in ChatService.active_visitors:
            del ChatService.active_visitors[self.conversation.id]

