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
import asyncio
from sqlalchemy.orm import Session

from app.services.conversation_service import ConversationService
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService
from app.models.user import User
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.core.logging import get_logger
from app.services.website_resolver import is_website_online

from app.core.message_presenter import serialize_message

logger = get_logger(__name__)

# Prevent scheduling duplicate delayed "waiting" bot messages
_waiting_bot_message_scheduled: set[int] = set()


async def _send_delayed_waiting_message_if_unassigned(*, conversation_id: int, website_id: int) -> None:
    """After 60s, if still unassigned, send a single bot message to the visitor."""
    try:
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation

        await asyncio.sleep(60)

        db = SessionLocal()
        try:
            conversation = db.query(Conversation).filter_by(id=conversation_id).first()
            if not conversation:
                return

            if conversation.assigned_agent_id:
                return

            # Only send if visitor is connected.
            # Persist as a bot message so both widget + agent dashboard show it.
            from app.services.conversation_service import ConversationService

            saved = ConversationService(db).add_bot_message(
                conversation_id,
                "Thanks! An agent will be with you shortly.",
                event_type="bot",
            )

            await ChatService.send_to_visitor(
                conversation_id,
                {
                    "type": "ai",
                    "message": "Thanks! An agent will be with you shortly.",
                    "message_obj": serialize_message(db, saved),
                },
            )
        finally:
            db.close()
    except Exception as e:
        logger.error(
            "delayed_waiting_message_failed",
            conversation_id=conversation_id,
            website_id=website_id,
            error=str(e),
            exc_info=True,
        )


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
        client_message_id: str | None = None,
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
            ChatService.register_visitor(conversation.id, visitor_ws)

        # If the visitor returns to a previously resolved conversation (same session_id),
        # reopen it and make it unassigned again.
        if conversation.status == ConversationStatus.RESOLVED:
            conversation.status = ConversationStatus.OPEN
            conversation.assigned_agent_id = None
            conversation.is_handoff = False
            self.db.commit()
            self.db.refresh(conversation)

        # Determine if this is the first message before persisting
        prior_message_count = (
            self.db.query(Message).filter_by(conversation_id=conversation.id).count()
        )

        # Persist visitor message
        msg = self.conversation_service.add_visitor_message(
            conversation_id=conversation.id,
            content=message,
        )
        if not msg:
            return "Unable to process your message right now."

        # Best-effort: acknowledge back to the visitor with server truth.
        # This lets the widget reconcile optimistic timestamps/IDs.
        if visitor_ws is not None and client_message_id:
            try:
                await visitor_ws.send_json(
                    {
                        "type": "visitor_message_saved",
                        "message_id": str(client_message_id),
                        "conversation_id": conversation.id,
                        "message_obj": serialize_message(self.db, msg),
                    }
                )
            except Exception:
                pass

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
                    # Canonical DTO for clients that want consistent schemas.
                    # Backwards-compatible: legacy clients can keep using `message`.
                    "message_obj": serialize_message(self.db, msg),
                },
            )

            # Explicit unread event type (client may ignore if already viewing).
            await self.agent_service.send_to_agent(
                conversation.assigned_agent_id,
                {
                    "type": "conversation_unread",
                    "conversation_id": conversation.id,
                    "website_id": website_id,
                    "delta": 1,
                },
            )

            # Web Push for assigned agent
            try:
                from app.repos import push_subscriptions as push_subs_repo
                from app.services.push_service import send_web_push_to_subscriptions
                
                subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids={conversation.assigned_agent_id})
                if subs:
                    send_web_push_to_subscriptions(
                        subscriptions=subs,
                        title=f"New message in conversation #{conversation.id}",
                        body=(message or "New message")[:120],
                        url=f"/dashboard/chats?sessionId={conversation.session_id}",
                    )
            except Exception as e:
                logger.error("assigned_agent_push_failed", error=str(e))

            return None

        # Unassigned: still notify agents in realtime so inbox updates immediately.
        # Broadcast to website-specific agent sockets and global (website_id=0) sockets.
        await self.agent_service.broadcast_to_active_agents(
            website_id=website_id,
            message_data={
                "type": "visitor_message",
                "conversation_id": conversation.id,
                "website_id": website_id,
                "message": message,
                "message_obj": serialize_message(self.db, msg),
            },
            include_global=True,
        )

        # Web Push for unassigned: notify all available agents
        try:
            from app.repos import push_subscriptions as push_subs_repo
            from app.services.push_service import send_web_push_to_subscriptions
            from app.models.user import User, UserRole

            candidates = (
                self.db.query(User)
                .filter(
                    User.is_active == True,  # noqa: E712
                    User.is_available == True,  # noqa: E712
                    User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER]),
                )
                .all()
            )
            agent_ids = {int(u.id) for u in candidates}
            subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=agent_ids)
            if subs:
                send_web_push_to_subscriptions(
                    subscriptions=subs,
                    title=f"Unassigned message - Website {website_id}",
                    body=(message or "New message")[:120],
                    url=f"/dashboard/chats?sessionId={conversation.session_id}",
                )
        except Exception:
            pass

        # Explicit unread event type for inbox badges.
        await self.agent_service.broadcast_to_active_agents(
            website_id=website_id,
            message_data={
                "type": "conversation_unread",
                "conversation_id": conversation.id,
                "website_id": website_id,
                "delta": 1,
            },
            include_global=True,
        )

        # No agent assigned yet.
        # If nobody is online, accept the message (leave-a-message flow).
        # Send a single bot prompt (no repeats).
        if not is_website_online(website_id):
            if prior_message_count == 0:
                # Persist the offline prompt as a bot message so it appears in thread history.
                saved = self.conversation_service.add_bot_message(
                    conversation.id,
                    "We're busy at the moment. Sorry about that. Leave us your email, and we will contact you as soon as possible.",
                    event_type="bot",
                )
                await ChatService.send_to_visitor(
                    conversation.id,
                    {
                        "type": "ai",
                        "message": "We're busy at the moment. Sorry about that. Leave us your email, and we will contact you as soon as possible.",
                        "message_obj": serialize_message(self.db, saved),
                    },
                )
            return None

        # Someone is online.
        # Broadcast new chat notification only once (on first message).
        if prior_message_count == 0:
            await self._broadcast_new_chat_to_agents(conversation)

        # Schedule a single waiting bot message after 60s if still unassigned.
        if conversation.id not in _waiting_bot_message_scheduled:
            _waiting_bot_message_scheduled.add(conversation.id)
            asyncio.create_task(
                _send_delayed_waiting_message_if_unassigned(
                    conversation_id=conversation.id,
                    website_id=website_id,
                )
            )

        return None
    
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
        
        # Broadcast ONLY to global notification sockets (website_id = 0).
        # This prevents duplicate notifications to agents connected to both sockets.
        await self.agent_service.broadcast_to_active_agents(
            website_id=None,
            message_data={
                "type": "new_chat",
                "conversation_id": conversation.id,
                "website_id": conversation.website_id,
                "website_name": website_name,
                "session_id": conversation.session_id,
                "last_message": last_message,
                "status": conversation.status.value,
                "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
            },
            include_global=True,
        )

        # Web Push: notify all available agents.
        # This is best-effort and requires VAPID keys to be configured.
        try:
            from app.repos import push_subscriptions as push_subs_repo
            from app.services.push_service import send_web_push_to_subscriptions

            from app.models.user import User, UserRole

            candidates = (
                self.db.query(User)
                .filter(
                    User.is_active == True,  # noqa: E712
                    User.is_available == True,  # noqa: E712
                    User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER]),
                )
                .all()
            )

            agent_ids = {int(u.id) for u in candidates}
            subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=agent_ids)

            if subs:
                send_web_push_to_subscriptions(
                    subscriptions=subs,
                    title="New chat",
                    body=(last_message or "New conversation")[:120],
                    url="/dashboard/chats",
                )
        except Exception:
            pass

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

        agent_name = user.name or "Support Agent"
        saved = self.conversation_service.add_system_message(
            conversation_id,
            f"{agent_name} joined the chat.",
            event_type="agent_join",
        )

        # Get agent details including avatar
        agent = self.db.query(User).filter_by(id=agent_id).first()
        
        # Notify visitor if connected
        await ChatService.send_to_visitor(
            conversation_id,
            {
                "type": "agent_joined",
                "message": f"{agent_name} joined the chat.",
                "message_obj": serialize_message(self.db, saved),
                "agent_avatar": agent.avatar_url if agent else None,
                "agent_name": agent.name if agent else agent_name,
            }
        )

        # Notify dashboards so lists refresh and unread can clear.
        await self.agent_service.broadcast_to_active_agents(
            website_id=conversation.website_id,
            message_data={
                "type": "conversation_assigned",
                "conversation_id": conversation_id,
                "website_id": conversation.website_id,
                "assigned_agent_id": agent_id,
            },
            include_global=True,
        )

        return {
            "success": True,
            "message_id": getattr(saved, "id", None),
            "message_obj": serialize_message(self.db, saved),
        }

    async def handle_agent_takeover(self, *, conversation_id: int, agent_id: int) -> dict:
        """Force-assign a conversation to a different agent (explicit confirmation UX)."""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        if conversation.status == ConversationStatus.RESOLVED:
            return {"error": "Conversation is closed"}

        user = self.db.query(User).filter(User.id == agent_id).first()
        if not user or not user.is_active:
            return {"error": "User not found or inactive"}

        previous_agent_id = conversation.assigned_agent_id

        conversation.status = ConversationStatus.OPEN
        conversation.assigned_agent_id = agent_id
        self.db.commit()

        agent_name = user.name or "Support Agent"
        saved = self.conversation_service.add_system_message(
            conversation_id,
            f"{agent_name} joined the chat.",
            event_type="agent_join",
        )

        # Notify visitor if connected
        await ChatService.send_to_visitor(
            conversation_id,
            {
                "type": "agent_joined",
                "message": "A support agent has joined the chat",
                "message_obj": serialize_message(self.db, saved),
                "agent_avatar": user.avatar_url,
                "agent_name": agent_name,
                "previous_agent_id": previous_agent_id,
            },
        )

        await self.agent_service.broadcast_to_active_agents(
            website_id=conversation.website_id,
            message_data={
                "type": "conversation_assigned",
                "conversation_id": conversation_id,
                "website_id": conversation.website_id,
                "assigned_agent_id": agent_id,
                "previous_agent_id": previous_agent_id,
            },
            include_global=True,
        )

        return {
            "success": True,
            "message_id": getattr(saved, "id", None),
            "message_obj": serialize_message(self.db, saved),
        }

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

        agent = self.db.query(User).filter(User.id == agent_id).first()
        agent_name = (agent.name if agent and agent.name else "Support Agent")

        # Canonical DTO for clients that want consistent schemas.
        message_obj = serialize_message(self.db, saved)
        
        await ChatService.send_to_visitor(
            conversation_id,
            {
                "type": "agent",
                "message": content,
                "message_obj": message_obj,
                "agent_name": agent_name,
                "agent_avatar": agent.avatar_url if agent else None,
                "created_at": saved.created_at.isoformat() if getattr(saved, "created_at", None) else None,
            }
        )

        return {
            "success": True,
            "message_id": getattr(saved, "id", None),
        }

    async def close_conversation(self, *, conversation_id: int) -> dict:
        """Close a conversation and emit final system message."""
        success = self.conversation_service.close_conversation(conversation_id)
        if not success:
            return {"error": "Conversation not found"}

        await ChatService.send_to_visitor(
            conversation_id,
            {
                "type": "system",
                "message": "This conversation has been closed.",
            }
        )

        # Notify dashboards to remove/refresh the closed conversation.
        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
            website_id = int(conversation.website_id) if conversation else None
        except Exception:
            website_id = None

        await self.agent_service.broadcast_to_active_agents(
            website_id=website_id,
            message_data={
                "type": "conversation_closed",
                "conversation_id": conversation_id,
                "website_id": website_id,
            },
            include_global=True,
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
            ChatService.register_visitor(conversation.id, visitor_ws)

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
