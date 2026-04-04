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
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.services.conversation_service import ConversationService
from app.services.automation_service import AutomationService
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService
from app.models.user import User
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.models.automation import Automation
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
            from app.models.message import MessageSenderType

            last = messages_repo.get_last_human_message(self.db, int(conversation.id))
            if not last:
                return False

            sender_type = getattr(last, "sender_type", None)
            # sender_type is usually a MessageSenderType enum value.
            if sender_type == MessageSenderType.AGENT:
                return True
            # Defensive: if DB/model ever returns a raw string.
            try:
                return str(getattr(sender_type, "value", sender_type) or "").strip().lower() == "agent"
            except Exception:
                return False
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

        # Title is only set from the offline contact form (visitor_name).
        # We no longer auto-generate titles from the first visitor message.

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

            # Web Push for assigned agent (non-blocking: runs in thread executor)
            try:
                from app.repos import push_subscriptions as push_subs_repo
                from app.services.push_service import send_web_push_to_subscriptions
                
                subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids={conversation.assigned_agent_id})
                if subs:
                    loop = asyncio.get_event_loop()
                    loop.run_in_executor(
                        None,
                        lambda: send_web_push_to_subscriptions(
                            subscriptions=subs,
                            title=f"New message in conversation #{conversation.short_id}",
                            body=(message or "New message")[:120],
                            url=f"/dashboard/chats/{conversation.short_id}",
                        ),
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

        # Web Push for unassigned: notify all available agents (non-blocking)
        try:
            from app.repos import push_subscriptions as push_subs_repo
            from app.services.push_service import send_web_push_to_subscriptions
            from app.models.user import User, UserRole

            candidates = (
                self.db.query(User)
                .filter(
                    User.is_active == True,  # noqa: E712
                    User.is_available == True,  # noqa: E712
                    User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER]),
                )
                .all()
            )
            agent_ids = {int(u.id) for u in candidates}
            subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=agent_ids)
            if subs:
                loop = asyncio.get_event_loop()
                loop.run_in_executor(
                    None,
                    lambda: send_web_push_to_subscriptions(
                        subscriptions=subs,
                        title=f"Unassigned message - Website {website_id}",
                        body=(message or "New message")[:120],
                        url=f"/dashboard/chats/{conversation.short_id}",
                    ),
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

            # Fire "conversation_created" automations (e.g., team routing chatbot).
            try:
                await self._fire_conversation_created_automations(
                    conversation=conversation,
                    website_id=website_id,
                    visitor_ws=visitor_ws,
                )
            except Exception as e:
                logger.warning("conversation_created_automation_failed", error=str(e))

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
                    User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER]),
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

    async def _fire_conversation_created_automations(
        self,
        *,
        conversation: Conversation,
        website_id: int,
        visitor_ws: Any | None = None,
    ) -> None:
        """Fire 'conversation_created' automations such as bot_prompt_buttons.

        If a bot_prompt_buttons action is found, send the prompt + buttons to
        the visitor via WebSocket so the widget can render interactive buttons.
        The prompt message is also persisted as a bot message for history replay.

        Skipped when the bot prompt was already sent during the welcome flow
        (``_send_delayed_welcome`` with ``chatbot_buttons``).
        """
        from app.repos import messages as messages_repo

        # Guard: skip if bot prompt buttons already sent (e.g. during welcome).
        existing = messages_repo.get_last_event_message(
            self.db, conversation.id, "bot_prompt_buttons"
        )
        if existing:
            return

        automation_service = AutomationService(self.db)
        prompt_actions = automation_service.get_actions_by_type(
            website_id=website_id,
            trigger="conversation_created",
            action_type="bot_prompt_buttons",
        )

        if not prompt_actions:
            return

        action = prompt_actions[0]  # Only first prompt for now
        message_text = action.get("message", "")
        buttons = action.get("buttons") or []
        automation_id = action.get("automation_id")

        if not message_text or not isinstance(message_text, str):
            return

        # Validate buttons — each needs a label; team_id is optional
        validated_buttons = []
        for i, btn in enumerate(buttons):
            if not isinstance(btn, dict):
                continue
            label = btn.get("label", "").strip()
            if not label:
                continue
            validated_buttons.append({
                "label": label,
                "team_id": btn.get("team_id"),
                "reply": btn.get("reply", ""),
            })

        # Persist with enriched JSON content for history replay
        enriched_content = json.dumps({
            "message": message_text.strip(),
            "automation_id": automation_id,
            "buttons": validated_buttons,
        })
        saved = self.conversation_service.add_bot_message(
            conversation.id,
            enriched_content,
            event_type="bot_prompt_buttons",
        )

        # Build the WS payload with buttons metadata
        ws_payload = {
            "type": "bot_prompt",
            "message": message_text.strip(),
            "conversation_id": conversation.id,
            "automation_id": automation_id,
            "buttons": validated_buttons,
            "message_obj": serialize_message(self.db, saved),
        }

        # Send to visitor
        if visitor_ws is not None:
            try:
                await visitor_ws.send_json(ws_payload)
            except Exception:
                pass
        else:
            await ChatService.send_to_visitor(conversation.id, ws_payload)

    async def handle_bot_button_click(
        self,
        *,
        conversation_id: int,
        automation_id: int,
        button_index: int,
        visitor_ws: Any | None = None,
    ) -> dict | None:
        """Handle a visitor clicking on a bot prompt button.

        Looks up the automation, finds the button at the given index, assigns the
        team (if configured), and sends a confirmation reply to the visitor.

        Returns a dict with result info, or None on error.
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            logger.warning("bot_button_click_no_conversation", conversation_id=conversation_id)
            return None

        automation = self.db.query(Automation).filter_by(id=automation_id).first()
        if not automation:
            logger.warning("bot_button_click_no_automation", automation_id=automation_id)
            return None

        # Extract the button from the automation's actions
        raw_actions = automation.actions or {}
        if isinstance(raw_actions, str):
            try:
                raw_actions = json.loads(raw_actions)
            except Exception:
                return None

        if isinstance(raw_actions, dict):
            raw_actions = [raw_actions]
        elif not isinstance(raw_actions, list):
            return None

        # Find the bot_prompt_buttons action
        prompt_action = None
        for act in raw_actions:
            if isinstance(act, dict) and str(act.get("type", "")).lower() == "bot_prompt_buttons":
                prompt_action = act
                break

        if not prompt_action:
            logger.warning("bot_button_click_no_prompt_action", automation_id=automation_id)
            return None

        buttons = prompt_action.get("buttons") or []
        if not isinstance(buttons, list) or button_index < 0 or button_index >= len(buttons):
            logger.warning("bot_button_click_invalid_index", automation_id=automation_id, button_index=button_index)
            return None

        button = buttons[button_index]
        if not isinstance(button, dict):
            return None

        label = button.get("label", "")
        team_id = button.get("team_id")
        reply = button.get("reply", "")

        result = {
            "label": label,
            "team_id": None,
            "team_name": None,
        }

        # Persist the visitor's button selection as a visitor message
        visitor_selection_msg = self.conversation_service.add_visitor_message(
            conversation_id=conversation.id,
            content=str(label),
        )

        # Broadcast the visitor's button click to agents
        if visitor_selection_msg:
            if conversation.assigned_agent_id:
                await self.agent_service.send_to_agent(
                    conversation.assigned_agent_id,
                    {
                        "type": "visitor_message",
                        "conversation_id": conversation.id,
                        "message": str(label),
                        "message_obj": serialize_message(self.db, visitor_selection_msg),
                    },
                )
            else:
                await self.agent_service.broadcast_to_active_agents(
                    website_id=int(conversation.website_id),
                    message_data={
                        "type": "visitor_message",
                        "conversation_id": conversation.id,
                        "website_id": int(conversation.website_id),
                        "message": str(label),
                        "message_obj": serialize_message(self.db, visitor_selection_msg),
                    },
                    include_global=True,
                )

        # Assign team if configured
        if team_id is not None:
            try:
                team_id = int(team_id)
                from app.models.website_team import WebsiteTeam

                team = self.db.query(WebsiteTeam).filter_by(id=team_id).first()
                if team and int(team.website_id) == int(conversation.website_id):
                    conversation.team_id = team.id
                    self.db.commit()
                    result["team_id"] = team.id
                    result["team_name"] = team.name

                    # Broadcast team change to agents
                    await self.agent_service.broadcast_to_active_agents(
                        website_id=int(conversation.website_id),
                        message_data={
                            "type": "conversation_team_changed",
                            "conversation_id": conversation.id,
                            "website_id": int(conversation.website_id),
                            "team_id": team.id,
                        },
                        include_global=True,
                    )

                    logger.info(
                        "bot_button_team_assigned",
                        conversation_id=conversation.id,
                        team_id=team.id,
                        team_name=team.name,
                        button_label=label,
                    )
                else:
                    logger.warning(
                        "bot_button_team_not_found",
                        team_id=team_id,
                        website_id=conversation.website_id,
                    )
            except Exception as e:
                logger.error("bot_button_team_assign_failed", error=str(e))

        # Send reply message to visitor
        if reply and isinstance(reply, str) and reply.strip():
            saved_reply = self.conversation_service.add_bot_message(
                conversation.id,
                reply.strip(),
                event_type="bot_button_reply",
            )

            reply_payload = {
                "type": "bot",
                "message": reply.strip(),
                "message_obj": serialize_message(self.db, saved_reply),
            }

            if visitor_ws is not None:
                try:
                    await visitor_ws.send_json(reply_payload)
                except Exception:
                    pass
            else:
                await ChatService.send_to_visitor(conversation.id, reply_payload)

        return result

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
            agent_email=agent.email,
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

    async def close_conversation(self, *, conversation_id: int, closed_by: str = "agent") -> dict:
        """Close a conversation.

        A canonical `conversation_resolved` event is always recorded so visitor
        lifecycle does not depend on optional automation wiring.
        """
        conversation = self.conversation_service.close_conversation(
            conversation_id,
            closed_by=closed_by,
        )
        if not conversation:
            return {"error": "Conversation not found"}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_trigger(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="conversation_resolved",
            default_system_event_type="conversation_resolved",
            default_bot_event_type="bot_closing",
            log_key="conversation_resolve_automation_failed",
            ensure_system_event=True,
            fallback_system_content=(
                "You ended the chat."
                if closed_by == "visitor"
                else "This conversation has been resolved."
            ),
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
                "closed_by": getattr(conversation, "closed_by", None),
            },
            include_global=True,
        )

        return {"success": True, "closed_by": getattr(conversation, "closed_by", None)}

    async def visitor_closed_chat(self, *, conversation_id: int) -> dict:
        """Visitor explicitly ended the chat UI.

        This resolves the active conversation with `closed_by='visitor'`.
        """
        return await self.close_conversation(conversation_id=conversation_id, closed_by="visitor")

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
        ensure_system_event: bool = False,
        fallback_system_content: str | None = None,
    ) -> None:
        if not website_id:
            return

        try:
            automation_service = AutomationService(self.db)

            system_actions = automation_service.get_system_event_actions(
                website_id=int(website_id),
                trigger=str(trigger),
            )
            emitted_system_event = False
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
                emitted_system_event = True
                if send_system_events_to_visitor:
                    message_obj = serialize_message(self.db, saved_evt)
                    payload = {
                        "type": "system",
                        "message": saved_evt.content,
                        "message_obj": message_obj,
                        "conversation_id": conversation_id,
                        "website_id": website_id,
                    }
                    if message_obj.get("closed_by"):
                        payload["closed_by"] = message_obj["closed_by"]
                    await ChatService.send_to_visitor(
                        conversation_id,
                        payload,
                    )

            if ensure_system_event and not emitted_system_event and default_system_event_type and fallback_system_content:
                saved_evt = self.conversation_service.add_system_message(
                    conversation_id,
                    str(fallback_system_content),
                    event_type=str(default_system_event_type),
                )
                if send_system_events_to_visitor:
                    message_obj = serialize_message(self.db, saved_evt)
                    payload = {
                        "type": "system",
                        "message": saved_evt.content,
                        "message_obj": message_obj,
                        "conversation_id": conversation_id,
                        "website_id": website_id,
                    }
                    if message_obj.get("closed_by"):
                        payload["closed_by"] = message_obj["closed_by"]
                    await ChatService.send_to_visitor(conversation_id, payload)

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
