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
from app.models.conversation import Conversation, ConversationStatus, ConversationMode
from app.models.agent_website_assignment import AgentWebsiteAssignment
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

        # Re-evaluate website online status on every message
        online = is_website_online(website_id)

        if not online:
            if conversation.status != ConversationStatus.OFFLINE:
                conversation.status = ConversationStatus.OFFLINE
                conversation.mode = ConversationMode.WAITING_FOR_AGENT
                self.db.commit()
                self.conversation_service.add_system_message(
                    conversation.id,
                    "We're currently offline. Your message has been saved for follow-up.",
                )
            return "We're currently offline. We've saved your message for follow-up."

        # If previously offline and now online, resume active routing
        if conversation.status == ConversationStatus.OFFLINE:
            conversation.status = ConversationStatus.ACTIVE
            conversation.mode = ConversationMode.WAITING_FOR_AGENT
            self.db.commit()
            self.conversation_service.add_system_message(
                conversation.id,
                "We're online now. Connecting you with an available agent.",
            )

        # Reject closed conversations
        if conversation.status == ConversationStatus.CLOSED:
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
            await self.agent_service.send_to_agent(
                conversation.assigned_agent_id,
                {
                    "type": "visitor_message",
                    "conversation_id": conversation.id,
                    "message": message,
                },
            )
            return None

        # No agent assigned yet
        if conversation.status == ConversationStatus.OFFLINE:
            return "We're currently offline. We've saved your message for follow-up."

        # Online but waiting for agent
        return "Thanks! An agent will be with you shortly."

    async def handle_agent_join(self, *, conversation_id: int, agent_id: int) -> dict:
        """Handle agent claiming/joining a conversation."""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        if conversation.status == ConversationStatus.CLOSED:
            return {"error": "Conversation is closed"}

        # Enforce eligibility for this website (assignment + active + available)
        assignment = (
            self.db.query(AgentWebsiteAssignment)
            .filter(
                AgentWebsiteAssignment.agent_id == agent_id,
                AgentWebsiteAssignment.website_id == conversation.website_id,
            )
            .first()
        )

        user = self.db.query(User).filter(User.id == agent_id).first()

        if not assignment or not user or not user.is_active or not user.is_available:
            return {"error": "Agent not eligible or not available for this website"}

        # Enforce single owner
        if conversation.assigned_agent_id and conversation.assigned_agent_id != agent_id:
            return {"error": "Conversation already assigned to another agent"}

        # Normalize status/mode
        conversation.status = ConversationStatus.ACTIVE
        conversation.mode = ConversationMode.AGENT_HANDLING
        conversation.assigned_agent_id = agent_id
        self.db.commit()

        self.conversation_service.add_system_message(
            conversation_id,
            "An agent has joined the conversation.",
        )

        # Notify visitor if connected
        chat_service = ChatService.get_by_conversation_id(self.db, conversation_id)
        if chat_service:
            await chat_service.send_to_visitor(
                {
                    "type": "agent_joined",
                    "message": "A support agent has joined the chat",
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

        if conversation.status == ConversationStatus.CLOSED:
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

        chat_service = ChatService.get_by_conversation_id(self.db, conversation_id)
        if chat_service:
            await chat_service.send_to_visitor(
                {
                    "type": "agent",
                    "message": content,
                }
            )

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
