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
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.services.conversation_service import ConversationService
from app.services.automation_service import AutomationService
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


def _should_skip_due_to_repeat(
    *,
    db: Session,
    conversation_id: int,
    event_type: str,
    repeat: str | None,
    repeat_cooldown_seconds: int | None,
) -> bool:
    """Return True if an automation action should be suppressed due to repeat rules.

    repeat:
    - once: at most once per conversation lifetime for this event_type (existing behavior)
    - cooldown: suppress if last event is within cooldown window
    - always: never suppress
    """

    mode = str(repeat or "").strip().lower() or "once"
    if mode == "always":
        return False

    from app.repos import messages as messages_repo

    existing = messages_repo.get_last_event_message(db, conversation_id, str(event_type))
    if not existing:
        return False

    if mode != "cooldown":
        return True

    # cooldown
    cooldown = repeat_cooldown_seconds
    if cooldown is None:
        return True

    created_at = getattr(existing, "created_at", None)
    if created_at is None:
        return True

    try:
        if getattr(created_at, "tzinfo", None) is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
    except Exception:
        return True

    now = datetime.now(timezone.utc)
    try:
        return (now - created_at).total_seconds() < float(cooldown)
    except Exception:
        return True


async def _send_delayed_waiting_message_if_unassigned(*, conversation_id: int, website_id: int, delay_seconds: int) -> None:
    """After 60s, if still unassigned, send a single bot message to the visitor."""
    try:
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation

        await asyncio.sleep(max(1, int(delay_seconds or 60)))

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
            from app.services.automation_service import AutomationService
            from app.repos import messages as messages_repo

            automation_service = AutomationService(db)
            actions = automation_service.get_bot_message_actions(
                website_id=website_id,
                trigger="no_agent_assigned_for",
            )

            if not actions:
                return

            for action in actions:
                event_type = action.get("event_type") or "bot_waiting"
                if _should_skip_due_to_repeat(
                    db=db,
                    conversation_id=conversation_id,
                    event_type=str(event_type),
                    repeat=action.get("repeat"),
                    repeat_cooldown_seconds=action.get("repeat_cooldown_seconds"),
                ):
                    continue

                saved = ConversationService(db).add_bot_message(
                    conversation_id,
                    action["message"],
                    event_type=event_type,
                )

                await ChatService.send_to_visitor(
                    conversation_id,
                    {
                        "type": "bot",
                        "message": action["message"],
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

    def _ensure_agent_available(self, user: User) -> bool:
        """Best-effort: flip availability to True when the agent actively works."""

        if user.is_available is False:
            user.is_available = True
            return True
        return False

    def _should_record_presence_event(self, *, conversation: Conversation) -> bool:
        """Presence timeline events should only be recorded for meaningful scenarios.

        Current rule (simple + practical): only record presence events when the
        last *human* message is from the agent (i.e. the visitor likely left after
        receiving an agent reply).
        """

        try:
            if conversation.status != ConversationStatus.OPEN:
                return False
        except Exception:
            return False

        # Require that the agent has actually participated.
        try:
            if not getattr(conversation, "last_agent_message_at", None):
                return False
        except Exception:
            return False

        try:
            from app.repos import messages as messages_repo

            last = messages_repo.get_last_human_message(self.db, int(conversation.id))
            if not last:
                return False
            return str(getattr(last, "sender_type", "")) == "agent"
        except Exception:
            return False

    async def handle_visitor_message(
        self,
        *,
        website_id: int,
        session_id: str,
        message: str,
        visitor_ws: Any | None = None,
        client_message_id: str | None = None,
        visitor_ip: str | None = None,
    ) -> Optional[str]:
        """Process a visitor message and route appropriately.

        Returns optional system text to send back to visitor immediately.
        """
        conversation = self.conversation_service.get_or_create_conversation(
            website_id=website_id,
            session_id=session_id,
            visitor_ip=visitor_ip,
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

            # Optional automations when reopening.
            try:
                from app.repos import messages as messages_repo

                automation_service = AutomationService(self.db)

                # Emit system events only if configured.
                system_actions = automation_service.get_system_event_actions(
                    website_id=website_id,
                    trigger="conversation_reopened",
                )
                for action in system_actions:
                    event_type = action.get("event_type") or "conversation_reopened"
                    content = action.get("content")
                    if not content:
                        continue

                    if _should_skip_due_to_repeat(
                        db=self.db,
                        conversation_id=conversation.id,
                        event_type=str(event_type),
                        repeat=action.get("repeat"),
                        repeat_cooldown_seconds=action.get("repeat_cooldown_seconds"),
                    ):
                        continue
                    saved_evt = self.conversation_service.add_system_message(
                        conversation.id,
                        str(content),
                        event_type=str(event_type),
                    )
                    if visitor_ws is not None:
                        try:
                            await visitor_ws.send_json(
                                {
                                    "type": "system",
                                    "message": saved_evt.content,
                                    "message_obj": serialize_message(self.db, saved_evt),
                                }
                            )
                        except Exception:
                            pass

                # Optional bot messages on reopen.
                bot_actions = automation_service.get_bot_message_actions(
                    website_id=website_id,
                    trigger="conversation_reopened",
                )
                for action in bot_actions:
                    event_type = action.get("event_type") or "bot_reopened"

                    if _should_skip_due_to_repeat(
                        db=self.db,
                        conversation_id=conversation.id,
                        event_type=str(event_type),
                        repeat=action.get("repeat"),
                        repeat_cooldown_seconds=action.get("repeat_cooldown_seconds"),
                    ):
                        continue
                    saved_bot = self.conversation_service.add_bot_message(
                        conversation.id,
                        action["message"],
                        event_type=str(event_type),
                    )
                    if visitor_ws is not None:
                        try:
                            await visitor_ws.send_json(
                                {
                                    "type": "bot",
                                    "message": action["message"],
                                    "message_obj": serialize_message(self.db, saved_bot),
                                }
                            )
                        except Exception:
                            pass
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass

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
        if (not is_website_online(website_id)) and not (
            prior_message_count > 0 and getattr(conversation, "assigned_agent_id", None)
        ):
            if prior_message_count == 0:
                automation_service = AutomationService(self.db)
                from app.repos import messages as messages_repo

                actions = automation_service.get_bot_message_actions(
                    website_id=website_id,
                    trigger="website_offline_first_message",
                )

                if not actions:
                    return None

                for action in actions:
                    event_type = action.get("event_type") or "bot_offline"
                    existing = messages_repo.get_last_event_message(
                        self.db, conversation.id, event_type
                    )
                    if existing:
                        continue

                    saved = self.conversation_service.add_bot_message(
                        conversation.id,
                        action["message"],
                        event_type=event_type,
                    )
                    await ChatService.send_to_visitor(
                        conversation.id,
                        {
                            "type": "bot",
                            "message": action["message"],
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
            automation_service = AutomationService(self.db)
            delay_seconds = automation_service.get_delay_seconds(
                website_id=website_id,
                trigger="no_agent_assigned_for",
                default_seconds=60,
            )
            asyncio.create_task(
                _send_delayed_waiting_message_if_unassigned(
                    conversation_id=conversation.id,
                    website_id=website_id,
                    delay_seconds=delay_seconds,
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

        # Any active user can join any chat.
        user = self.db.query(User).filter(User.id == agent_id).first()

        if not user or not user.is_active:
            return {"error": "User not found or inactive"}

        # Practical behavior: if an agent starts handling a chat, treat them as available.
        # This avoids confusing states where an agent is "unavailable" but actively joins chats.
        availability_changed = self._ensure_agent_available(user)

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
            "agent_is_available": bool(getattr(user, "is_available", False)),
            "availability_changed": availability_changed,
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

        availability_changed = self._ensure_agent_available(user)

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
            "agent_is_available": bool(getattr(user, "is_available", False)),
            "availability_changed": availability_changed,
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

        agent = self.db.query(User).filter(User.id == agent_id).first()
        if not agent or not agent.is_active:
            return {"error": "User not found or inactive"}

        availability_changed = self._ensure_agent_available(agent)

        saved = self.conversation_service.add_agent_message(
            conversation_id=conversation_id,
            agent_id=agent_id,
            agent_email=str(agent_id),
            content=content,
        )
        if not saved:
            return {"error": "Unable to add message"}

        logger.info("agent_message_saved", conversation_id=conversation_id, agent_id=agent_id, content_length=len(content))

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
            "agent_is_available": bool(getattr(agent, "is_available", False)),
            "availability_changed": availability_changed,
        }

    async def close_conversation(self, *, conversation_id: int) -> dict:
        """Close a conversation.

        Visitor-facing messages are automation-driven (no hardcoded close text).
        """
        conversation = self.conversation_service.close_conversation(conversation_id)
        if not conversation:
            return {"error": "Conversation not found"}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        # Optional: automation-driven system event + bot closing message.
        await self._run_automation_trigger(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="conversation_resolved",
            default_system_event_type="conversation_resolved",
            default_bot_event_type="bot_closing",
            log_key="conversation_resolve_automation_failed",
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

    async def visitor_closed_chat(self, *, conversation_id: int) -> dict:
        """Visitor explicitly ended the chat UI.

        This MUST NOT resolve the conversation; only agents decide that.
        """
        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        except Exception:
            conversation = None

        if not conversation:
            return {"error": "Conversation not found"}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_trigger(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_closed_chat",
            default_system_event_type="visitor_closed_chat",
            default_bot_event_type="bot_visitor_closed",
            log_key="visitor_closed_chat_automation_failed",
        )

        # Best-effort realtime notice to dashboards.
        try:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_closed_chat",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )
        except Exception:
            pass

        return {"success": True}

    async def visitor_socket_connected(self, *, conversation_id: int) -> dict:
        """Visitor websocket connected for an existing conversation.

        This is used for Smartsupp-like timeline events (e.g. visitor connected/left).
        These are dashboard/internal events and should not be pushed into the visitor UI.
        """
        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        except Exception:
            conversation = None

        if not conversation:
            return {"error": "Conversation not found"}

        if not self._should_record_presence_event(conversation=conversation):
            return {"success": True}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_trigger(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_socket_connected",
            default_system_event_type="visitor_socket_connected",
            default_bot_event_type=None,
            log_key="visitor_socket_connected_automation_failed",
            send_system_events_to_visitor=False,
            send_bot_messages_to_visitor=False,
        )

        try:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_socket_connected",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )
        except Exception:
            pass

        return {"success": True}

    async def visitor_left_website(self, *, conversation_id: int) -> dict:
        """Visitor websocket appears to have disconnected (left the website/tab)."""

        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        except Exception:
            conversation = None

        if not conversation:
            return {"error": "Conversation not found"}

        if not self._should_record_presence_event(conversation=conversation):
            return {"success": True}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_trigger(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_left_website",
            default_system_event_type="visitor_left_website",
            default_bot_event_type=None,
            log_key="visitor_left_website_automation_failed",
            send_system_events_to_visitor=False,
            send_bot_messages_to_visitor=False,
        )

        try:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_left_website",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )
        except Exception:
            pass

        return {"success": True}

    async def _run_automation_trigger(
        self,
        *,
        conversation_id: int,
        website_id: int | None,
        trigger: str,
        default_system_event_type: str | None,
        default_bot_event_type: str | None,
        log_key: str,
        send_system_events_to_visitor: bool = True,
        send_bot_messages_to_visitor: bool = True,
    ) -> None:
        if not website_id:
            return

        try:
            automation_service = AutomationService(self.db)

            system_actions = automation_service.get_system_event_actions(
                website_id=int(website_id),
                trigger=str(trigger),
            )
            for action in system_actions:
                event_type = action.get("event_type") or default_system_event_type or str(trigger)
                content = action.get("content")
                if not content:
                    continue

                if _should_skip_due_to_repeat(
                    db=self.db,
                    conversation_id=conversation_id,
                    event_type=str(event_type),
                    repeat=action.get("repeat"),
                    repeat_cooldown_seconds=action.get("repeat_cooldown_seconds"),
                ):
                    continue

                saved_evt = self.conversation_service.add_system_message(
                    conversation_id,
                    str(content),
                    event_type=str(event_type),
                )
                if send_system_events_to_visitor:
                    await ChatService.send_to_visitor(
                        conversation_id,
                        {
                            "type": "system",
                            "message": saved_evt.content,
                            "message_obj": serialize_message(self.db, saved_evt),
                        },
                    )

            bot_actions = automation_service.get_bot_message_actions(
                website_id=int(website_id),
                trigger=str(trigger),
            )
            for action in bot_actions or []:
                event_type = action.get("event_type") or default_bot_event_type
                if not event_type:
                    continue

                if _should_skip_due_to_repeat(
                    db=self.db,
                    conversation_id=conversation_id,
                    event_type=str(event_type),
                    repeat=action.get("repeat"),
                    repeat_cooldown_seconds=action.get("repeat_cooldown_seconds"),
                ):
                    continue

                saved_bot = self.conversation_service.add_bot_message(
                    conversation_id,
                    action["message"],
                    event_type=str(event_type),
                )
                if send_bot_messages_to_visitor:
                    await ChatService.send_to_visitor(
                        conversation_id,
                        {
                            "type": "bot",
                            "message": action["message"],
                            "message_obj": serialize_message(self.db, saved_bot),
                        },
                    )
        except Exception as e:
            logger.error(
                str(log_key),
                conversation_id=conversation_id,
                website_id=website_id,
                trigger=str(trigger),
                error=str(e),
                exc_info=True,
            )

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
