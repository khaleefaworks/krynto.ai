"""
Conversation Orchestrator - single authority for chat routing and state transitions.

Purpose:
- Centralize conversation ownership, state changes, and message routing.
- Keep API/WS layers transport+validation only.
- Keep helper services pure (persistence, eligibility checks, delivery).

Scope:
- All visitor messages route to human agents or offline mode
- No AI integration - pure human agent workflow
"""

from typing import Optional, Any
from sqlalchemy.orm import Session

from app.services.conversation_service import ConversationService
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService
from app.services.website_resolver import is_website_online, get_eligible_agents_for_website
from app.models.user import User
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.core.logging import get_logger

logger = get_logger(__name__)
from app.models.conversation import Conversation, ConversationStatus

from app.models.user import User
from app.core.logging import get_logger

logger = get_logger(__name__)


class ConversationOrchestrator:
    """Coordinates visitor/agent events and enforces chat invariants."""

    def __init__(self, db: Session):
        self.db = db
        self.conversation_service = ConversationService(db)
        self.agent_service = AgentService(db)

    async def handle_visitor_message(
        self,
        *,
        website_id: int,
        session_id: str,
        message: str,
        visitor_ws: Any | None = None,
    ) -> Optional[str]:
        """Process a visitor message and route appropriately.

        Returns optional system text to send back to visitor immediately.
        """
        conversation = self.conversation_service.get_or_create_conversation(
            website_id=website_id,
            session_id=session_id,
        )

        # Track the live visitor socket for downstream forwarding
        if visitor_ws:
            ChatService.active_visitors[conversation.id] = visitor_ws

        # Check if conversation is resolved
        if conversation.status == ConversationStatus.RESOLVED:
            return "This conversation has been closed."

        # Persist visitor message
        msg = self.conversation_service.add_visitor_message(
            conversation_id=conversation.id,
            content=message,
        )
        if not msg:
            return "Unable to process your message right now."

        # If an agent owns the conversation, forward to that agent
        if conversation.assigned_agent_id:
            logger.info("forwarding_visitor_message", 
                       conversation_id=conversation.id, 
                       assigned_agent_id=conversation.assigned_agent_id,
                       message_length=len(message))
            await self.agent_service.send_to_agent(
                conversation.assigned_agent_id,
                {
                    "type": "visitor_message",
                    "conversation_id": conversation.id,
                    "message": message,
                },
            )
            return None

        # No agent assigned yet - broadcast to all available agents for this website
        await self._broadcast_new_chat_to_agents(conversation)
        
        return "Thanks! An agent will be with you shortly."
    
    async def _broadcast_new_chat_to_agents(self, conversation: Conversation):
        """Notify all connected agents about new unassigned chat via global notification socket"""
        # Only broadcast if conversation is still open and unassigned
        if conversation.status != ConversationStatus.OPEN or conversation.assigned_agent_id:
            return
        
        # Get website info
        from app.models.website import Website
        website = self.db.query(Website).filter_by(id=conversation.website_id).first()
        website_name = website.name if website else f"Website {conversation.website_id}"
        
        # Get last message
        last_msg = self.db.query(Message).filter_by(
            conversation_id=conversation.id
        ).order_by(Message.created_at.desc()).first()
        last_message = last_msg.content if last_msg else "New conversation"
        
        # Broadcast ONLY to global notification sockets (website_id = 0)
        # This prevents duplicate notifications to agents connected to both sockets
        for ws_id, agent_info in AgentService.active_agents.items():
            # Only send to global notification socket (website_id = 0)
            if agent_info.get("website_id") == 0:
                try:
                    await agent_info["websocket"].send_json({
                        "type": "new_chat",
                        "conversation_id": conversation.id,
                        "website_id": conversation.website_id,
                        "website_name": website_name,
                        "session_id": conversation.session_id,
                        "last_message": last_message,
                        "status": conversation.status.value,
                        "created_at": conversation.created_at.isoformat() if conversation.created_at else None
                    })
                    logger.info("broadcast_new_chat_success", agent_id=agent_info["agent_id"], conversation_id=conversation.id, via="global_socket")
                except Exception as e:
                    logger.error("broadcast_error", error=str(e), agent_ws_id=ws_id)

    async def handle_agent_join(self, *, conversation_id: int, agent_id: int) -> dict:
        """Handle agent claiming/joining a conversation."""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        if conversation.status == ConversationStatus.RESOLVED:
            return {"error": "Conversation is closed"}

        # Simplified: Any active user can join any chat
        user = self.db.query(User).filter(User.id == agent_id).first()

        if not user or not user.is_active:
            return {"error": "User not found or inactive"}

        # Enforce single owner
        if conversation.assigned_agent_id and conversation.assigned_agent_id != agent_id:
            return {"error": "Conversation already assigned to another agent"}

        # Assign agent to conversation
        conversation.status = ConversationStatus.OPEN
        conversation.assigned_agent_id = agent_id
        self.db.commit()

        self.conversation_service.add_system_message(
            conversation_id,
            "An agent has joined the conversation.",
        )

        # Get agent details including avatar
        agent = self.db.query(User).filter_by(id=agent_id).first()
        
        # Notify visitor if connected
        chat_service = ChatService.get_by_conversation_id(self.db, conversation_id)
        if chat_service:
            await chat_service.send_to_visitor(
                {
                    "type": "agent_joined",
                    "message": "A support agent has joined the chat",
                    "agent_avatar": agent.avatar_url if agent else None,
                    "agent_name": agent.name if agent else "Support Agent"
                }
            )

        return {"success": True}

    async def handle_agent_message(
        self, *, conversation_id: int, agent_id: int, content: str
    ) -> dict:
        """Process an agent message to the visitor."""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        if conversation.status == ConversationStatus.RESOLVED:
            return {"error": "Conversation is closed"}

        if conversation.assigned_agent_id != agent_id:
            return {"error": "Conversation is assigned to another agent"}

        saved = self.conversation_service.add_agent_message(
            conversation_id=conversation_id,
            agent_id=agent_id,
            agent_email=str(agent_id),
            content=content,
        )
        if not saved:
            return {"error": "Unable to add message"}

        logger.info("agent_message_saved", conversation_id=conversation_id, agent_id=agent_id, content_length=len(content))
        
        chat_service = ChatService.get_by_conversation_id(self.db, conversation_id)
        if chat_service:
            logger.info("sending_agent_message_to_visitor", conversation_id=conversation_id)
            await chat_service.send_to_visitor(
                {
                    "type": "agent",
                    "message": content,
                }
            )
        else:
            logger.warning("no_visitor_socket", conversation_id=conversation_id)

        return {"success": True}

    async def close_conversation(self, *, conversation_id: int) -> dict:
        """Close a conversation and emit final system message."""
        success = self.conversation_service.close_conversation(conversation_id)
        if not success:
            return {"error": "Conversation not found"}

        chat_service = ChatService.get_by_conversation_id(self.db, conversation_id)
        if chat_service:
            await chat_service.send_to_visitor(
                {
                    "type": "system",
                    "message": "This conversation has been closed.",
                }
            )

        return {"success": True}

    async def handle_reconnect(
        self,
        *,
        conversation_id: int,
        visitor_ws: Any | None = None,
        agent_id: Optional[int] = None,
    ) -> None:
        """Re-attach sockets after reconnect events."""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return

        if visitor_ws:
            ChatService.active_visitors[conversation.id] = visitor_ws

        # If agent reconnects, ensure assignment is still valid
        if agent_id and conversation.assigned_agent_id != agent_id:
            logger.warning(
                "agent_reconnect_mismatch",
                conversation_id=conversation_id,
                assigned=conversation.assigned_agent_id,
                reconnecting=agent_id,
            )

    # Convenience: expose Conversation model for internal queries
    @property
    def model(self):  # noqa: D401
        return Conversation
