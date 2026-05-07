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
from app.models.message import Message, MessageSenderType
from app.models.automation import Automation
from app.core.logging import get_logger
from app.services.website_resolver import is_website_online

from app.core.message_presenter import serialize_message

logger = get_logger(__name__)

# Prevent scheduling duplicate delayed "waiting" bot messages
_waiting_bot_message_scheduled: set[int] = set()


def _get_eligible_agent_ids_for_push(
    db: Session, *, website_id: int, conversation_team_id: int | None = None
) -> set[int]:
    """Return IDs of agents who should receive push notifications.

    Scoping rules (org-aware, multi-tenant):
    - SYSTEM_MANAGER: always eligible (cross-org administrator).
    - OWNER/MANAGER of the website's org: always eligible.
    - AGENT: only if directly assigned to this website via AgentWebsiteAssignment.
      - If conversation_team_id is set:
        * Only members of that specific team → eligible.
        * Agents in a different team or in no team → excluded.
        * No-team agents are spectators for team-assigned chats (no push, no unread).
      - If conversation_team_id is None (unassigned conversation):
        * All assigned agents on the website → eligible (any can claim it).
    - All candidates must be is_active=True AND is_available=True.
    """
    from app.models.user import UserRole
    from app.models.website import Website
    from app.models.agent_website_assignment import AgentWebsiteAssignment
    from app.models.website_team import WebsiteTeam, WebsiteTeamMember

    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        return set()

    org_id = website.organization_id
    eligible: set[int] = set()

    # SYSTEM_MANAGER — active + available system managers (cross-org)
    sys_mgrs = (
        db.query(User)
        .filter(
            User.is_active == True,   # noqa: E712
            User.is_available == True,  # noqa: E712
            User.role == UserRole.SYSTEM_MANAGER,
        )
        .all()
    )
    eligible.update(int(u.id) for u in sys_mgrs)

    if org_id is not None:
        # OWNER/MANAGER in same org
        org_admins = (
            db.query(User)
            .filter(
                User.is_active == True,   # noqa: E712
                User.is_available == True,  # noqa: E712
                User.organization_id == org_id,
                User.role.in_([UserRole.OWNER, UserRole.MANAGER]),
            )
            .all()
        )
        eligible.update(int(u.id) for u in org_admins)

    # AGENT: must be directly assigned to this website
    assigned_rows = (
        db.query(AgentWebsiteAssignment.agent_id)
        .filter(AgentWebsiteAssignment.website_id == website_id)
        .all()
    )
    assigned_agent_ids = {int(r[0]) for r in assigned_rows}

    if assigned_agent_ids:
        if conversation_team_id is not None:
            # Conversation is assigned to a specific team.
            # Only members of that exact team get push — no-team agents are spectators.
            specific_team_member_rows = (
                db.query(WebsiteTeamMember.user_id)
                .filter(WebsiteTeamMember.team_id == conversation_team_id)
                .all()
            )
            specific_team_member_ids = {int(r[0]) for r in specific_team_member_rows}
            agent_candidates = assigned_agent_ids & specific_team_member_ids
        else:
            # No conversation team (unassigned conversation) → all assigned agents are
            # candidates, regardless of team membership. Agents not in any team are
            # unrestricted (see all conversations for their website). Agents in teams also
            # receive this because the conversation isn't assigned to a team yet — any
            # agent can claim/assign it.
            agent_candidates = assigned_agent_ids

        if agent_candidates:
            agents = (
                db.query(User)
                .filter(
                    User.id.in_(agent_candidates),
                    User.is_active == True,   # noqa: E712
                    User.is_available == True,  # noqa: E712
                )
                .all()
            )
            eligible.update(int(u.id) for u in agents)

    return eligible


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
    """After delay_seconds, if still unassigned, run the no_agent_assigned_for automation flow."""
    try:
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation

        await asyncio.sleep(max(1, int(delay_seconds or 60)))

        db = SessionLocal()
        try:
            conversation = db.query(Conversation).filter_by(id=conversation_id).first()
            if not conversation or conversation.assigned_agent_id:
                return

            # Skip waiting message when website is offline — the
            # website_offline_first_message automation already told the visitor
            # we'll contact them, so "An agent will be with you shortly" would
            # be misleading.
            if not is_website_online(website_id):
                return

            orchestrator = ConversationOrchestrator(db)
            await orchestrator._run_automation_flows(
                conversation_id=conversation_id,
                website_id=website_id,
                trigger="no_agent_assigned_for",
                log_key="delayed_waiting_message_failed",
                send_to_visitor=True,
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
    finally:
        _waiting_bot_message_scheduled.discard(conversation_id)


async def _fallback_resolve_notification(*, conversation_id: int, resolved_name: str) -> None:
    """Safety-net fired as a background task when the agent resolves a conversation.

    Waits 5 seconds (enough time for any automation to run), then checks whether
    the automation already delivered a `show_rating_popup` event.  If it did, we
    do nothing.  If not (no automation configured, or automation flow had no
    show_rating_popup node), we send the bare minimum needed so the visitor's
    widget transitions to the closed / read-only state:
      1. A `conversation_resolved` system notification (triggers the 7-second
         safety-timeout in the widget that hides the input).
      2. A `show_rating_popup` message (shows rating overlay immediately).

    Using a fresh DB session is intentional — the orchestrator's session is
    already closed by the time this coroutine resumes.
    """
    await asyncio.sleep(5)

    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        already_shown = (
            db.query(Message)
            .filter_by(conversation_id=conversation_id, event_type="rating_popup_shown")
            .first()
        )
    finally:
        db.close()

    if already_shown:
        # Automation handled it — nothing to do.
        return

    logger.info(
        "resolve_rating_fallback_triggered",
        conversation_id=conversation_id,
    )

    # Send conversation_resolved first so the widget sets ratingTriggeredByAgentResolve
    # and starts its own safety timeout (hides input after 7 s even if popup is missed).
    await ChatService.send_to_visitor(
        conversation_id,
        {
            "type": "system",
            "event_type": "conversation_resolved",
            "message": f"{resolved_name} has resolved this conversation.",
            "conversation_id": conversation_id,
        },
    )
    await asyncio.sleep(1)
    # Send show_rating_popup so the rating overlay appears immediately.
    await ChatService.send_to_visitor(
        conversation_id,
        {"type": "show_rating_popup", "conversation_id": conversation_id},
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
        """Presence timeline events should only be recorded once the visitor has
        actually initiated a chat (sent at least one message or clicked a button).

        This prevents noisy dropped/reconnected events for visitors who only
        browsed without engaging.
        """

        try:
            if conversation.status != ConversationStatus.OPEN:
                return False
        except Exception:
            return False

        # Record if the visitor has sent at least one message.
        try:
            has_visitor_message = getattr(conversation, "last_visitor_message_at", None) is not None
            if has_visitor_message:
                return True
        except Exception:
            pass

        # Fallback: count visitor messages directly.
        try:
            from app.models.message import MessageSenderType as _ST
            count = (
                self.db.query(Message)
                .filter(
                    Message.conversation_id == conversation.id,
                    Message.sender_type == _ST.VISITOR,
                )
                .limit(1)
                .count()
            )
            return count > 0
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
        visitor_name: str | None = None,
        visitor_email: str | None = None,
        visitor_phone: str | None = None,
    ) -> Optional[str]:
        """Process a visitor message and route appropriately.

        Returns optional system text to send back to visitor immediately.
        """
        conversation = self.conversation_service.get_or_create_conversation(
            website_id=website_id,
            session_id=session_id,
            visitor_ip=visitor_ip,
        )

        # Save visitor contact metadata *before* broadcasting so that when agents'
        # fetchActiveChats() fires in response to the visitor_message event the DB
        # already contains the up-to-date visitor profile.
        if visitor_name or visitor_email or visitor_phone:
            try:
                changed = False
                if visitor_name and not conversation.visitor_name:
                    conversation.visitor_name = str(visitor_name)
                    changed = True
                if visitor_email and not conversation.visitor_email:
                    conversation.visitor_email = str(visitor_email)
                    changed = True
                if visitor_phone and not conversation.visitor_phone:
                    conversation.visitor_phone = str(visitor_phone)
                    changed = True
                if changed:
                    self.db.commit()
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass

        # Track the live visitor socket for downstream forwarding
        if visitor_ws:
            ChatService.register_visitor(conversation.id, visitor_ws)

        # Determine if this is the first *visitor* message before persisting.
        # Bot welcome / system messages must NOT count — if they did, a bot
        # welcome sent before the visitor types would suppress the new_chat
        # broadcast and the agent would never hear the "New chat" sound.
        prior_message_count = (
            self.db.query(Message)
            .filter(
                Message.conversation_id == conversation.id,
                Message.sender_type == MessageSenderType.VISITOR,
            )
            .count()
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

            # Also broadcast to all other connected agents so they can spectate live.
            # The assigned agent already received the message above; exclude them to avoid
            # double-delivery. Spectators receive visitor_message events but not push notifications.
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_message",
                    "conversation_id": conversation.id,
                    "website_id": website_id,
                    "message": message,
                    "message_obj": serialize_message(self.db, msg),
                    # Clients use this to skip rendering if they are the assigned agent
                    # (they already have the message from send_to_agent above).
                    "_assigned_agent_id": conversation.assigned_agent_id,
                },
                include_global=True,
                exclude_agent_id=conversation.assigned_agent_id,
                conversation_team_id=getattr(conversation, "team_id", None),
            )

            return None

        # Unassigned: still notify agents in realtime so inbox updates immediately.
        # Broadcast to website-specific agent sockets and global (website_id=0) sockets.
        _conv_team_id = getattr(conversation, "team_id", None)
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
            conversation_team_id=_conv_team_id,
        )

        # Web Push for unassigned subsequent messages (non-blocking).
        # Skipped for the first visitor message (prior_message_count == 0) because
        # _broadcast_new_chat_to_agents() already sends a "New chat" push for that case.
        # Sending both would result in duplicate OS notifications for the agent.
        if prior_message_count > 0:
            try:
                from app.repos import push_subscriptions as push_subs_repo
                from app.services.push_service import send_web_push_to_subscriptions

                agent_ids = _get_eligible_agent_ids_for_push(
                    self.db, website_id=website_id, conversation_team_id=_conv_team_id
                )
                subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=agent_ids)
                if subs:
                    loop = asyncio.get_event_loop()
                    loop.run_in_executor(
                        None,
                        lambda: send_web_push_to_subscriptions(
                            subscriptions=subs,
                            title="New message",
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
            conversation_team_id=_conv_team_id,
        )

        # Always notify agents of new unassigned conversations regardless of
        # online/offline status.  The is_website_online gate below is only for
        # the bot offline automation — not for whether agents hear the sound /
        # receive a push notification.
        if prior_message_count == 0:
            await self._broadcast_new_chat_to_agents(conversation)

        # No agent assigned yet.
        # If nobody is online, accept the message (leave-a-message flow).
        # Fire website_offline_first_message once per conversation regardless
        # of whether this is the first message — covers the mid-conversation
        # case where the website goes offline after a chat has started.
        # The automation's repeat=once policy prevents duplicate sends.
        if not is_website_online(website_id) and not conversation.assigned_agent_id:
            await self._run_automation_flows(
                conversation_id=conversation.id,
                website_id=website_id,
                trigger="website_offline_first_message",
                log_key="offline_first_message_automation_failed",
                send_to_visitor=True,
                context={
                    "phone": conversation.visitor_phone or "",
                    "email": conversation.visitor_email or "",
                },
            )
            return None

        # Someone is online.
        # Fire visitor_new / visitor_returning on the very first message.
        if prior_message_count == 0:
            try:
                prior_conv_count = (
                    self.db.query(Conversation)
                    .filter(
                        Conversation.session_id == session_id,
                        Conversation.website_id == website_id,
                        Conversation.id != conversation.id,
                    )
                    .count()
                )
                visitor_type_trigger = "visitor_returning" if prior_conv_count > 0 else "visitor_new"
                await self._run_automation_flows(
                    conversation_id=conversation.id,
                    website_id=website_id,
                    trigger=visitor_type_trigger,
                    log_key=f"{visitor_type_trigger}_automation_failed",
                    send_to_visitor=True,
                )
            except Exception as e:
                logger.warning("visitor_type_trigger_failed", error=str(e))

        # Fire "conversation_created" automations (e.g., team routing chatbot).
        if prior_message_count == 0:
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
        _new_chat_team_id = getattr(conversation, "team_id", None)
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
            conversation_team_id=_new_chat_team_id,
        )

        # Web Push: notify eligible agents (scoped to this website's org + teams).
        # This is best-effort and requires VAPID keys to be configured.
        try:
            from app.repos import push_subscriptions as push_subs_repo
            from app.services.push_service import send_web_push_to_subscriptions

            agent_ids = _get_eligible_agent_ids_for_push(
                self.db,
                website_id=int(conversation.website_id),
                conversation_team_id=_new_chat_team_id,
            )
            subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=agent_ids)

            if subs:
                loop = asyncio.get_event_loop()
                loop.run_in_executor(
                    None,
                    lambda: send_web_push_to_subscriptions(
                        subscriptions=subs,
                        title="New chat",
                        body=(last_message or "New conversation")[:120],
                        url="/dashboard/chats",
                    ),
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
        """Fire 'conversation_created' automation flows.

        Delegates entirely to the graph executor. Skipped if bot_prompt_buttons
        was already sent (guard via idempotency check inside _execute_flow).
        """
        from app.repos import messages as messages_repo

        existing = messages_repo.get_last_event_message(
            self.db, conversation.id, "bot_prompt_buttons"
        )
        if existing:
            return

        await self._run_automation_flows(
            conversation_id=conversation.id,
            website_id=website_id,
            trigger="conversation_created",
            log_key="conversation_created_automation_failed",
            send_to_visitor=True,
        )

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

        # Find the bot_prompt_buttons node in the automation graph
        prompt_node_cfg = None
        for node in (automation.nodes or []):
            if isinstance(node, dict) and str(node.get("type", "")).lower() == "bot_prompt_buttons":
                prompt_node_cfg = node.get("config") or {}
                break

        if prompt_node_cfg is None:
            logger.warning("bot_button_click_no_prompt_node", automation_id=automation_id)
            return None

        buttons = prompt_node_cfg.get("buttons") or []
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

        # Count prior visitor messages BEFORE persisting so we can detect whether
        # this button click is the visitor's first message (e.g., buttons were shown
        # on connect before the visitor typed anything).
        prior_visitor_msg_count = (
            self.db.query(Message)
            .filter(
                Message.conversation_id == conversation.id,
                Message.sender_type == MessageSenderType.VISITOR,
            )
            .count()
        )

        # Persist the visitor's button selection as a visitor message
        visitor_selection_msg = self.conversation_service.add_visitor_message(
            conversation_id=conversation.id,
            content=str(label),
        )

        # If this is the visitor's first message, send new_chat notification
        # (sound + push) to agents instead of — or in addition to — visitor_message.
        # This covers the common flow where chatbot buttons are shown on connect
        # and the button click is the visitor's opening action.
        if prior_visitor_msg_count == 0:
            await self._broadcast_new_chat_to_agents(conversation)

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

        # IVR complete: tell the widget it can now reveal the free-form input.
        try:
            await ChatService.send_to_visitor(
                conversation.id,
                {"type": "automation_complete", "conversation_id": conversation.id},
            )
        except Exception:
            pass

        # If website is offline and no agent assigned, fire the offline prompt
        # immediately (the repeat=once policy prevents duplicates).  Skip the
        # waiting-message timer since it would contradict the offline message.
        if not conversation.assigned_agent_id and not is_website_online(int(conversation.website_id)):
            await self._run_automation_flows(
                conversation_id=conversation.id,
                website_id=int(conversation.website_id),
                trigger="website_offline_first_message",
                log_key="offline_first_message_from_button_click_failed",
                send_to_visitor=True,
                context={
                    "phone": conversation.visitor_phone or "",
                    "email": conversation.visitor_email or "",
                },
            )
        elif not conversation.assigned_agent_id and conversation.id not in _waiting_bot_message_scheduled:
            # Schedule the waiting bot message if this is the visitor's first action
            # and no agent is assigned yet. Regular messages schedule it in
            # handle_visitor_message; button clicks are a separate code path so we
            # must handle it here too.
            _waiting_bot_message_scheduled.add(conversation.id)
            automation_service = AutomationService(self.db)
            delay_seconds = automation_service.get_delay_seconds(
                website_id=int(conversation.website_id),
                trigger="no_agent_assigned_for",
                default_seconds=60,
            )
            asyncio.create_task(
                _send_delayed_waiting_message_if_unassigned(
                    conversation_id=conversation.id,
                    website_id=int(conversation.website_id),
                    delay_seconds=delay_seconds,
                )
            )

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

        # Push the system message to all agents' open threads in real-time.
        await self.agent_service.broadcast_to_active_agents(
            website_id=conversation.website_id,
            message_data={
                "type": "system_message",
                "conversation_id": conversation_id,
                "website_id": conversation.website_id,
                "message_obj": serialize_message(self.db, saved),
            },
            include_global=True,
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

        # Fire agent_joined automation trigger (e.g. tag_with_agent_name).
        website_id_int = int(conversation.website_id)
        try:
            await self._run_automation_flows(
                conversation_id=conversation_id,
                website_id=website_id_int,
                trigger="agent_joined",
                log_key="agent_joined_automation_failed",
                send_to_visitor=False,
                context={"agent_name": agent_name},
            )
        except Exception:
            pass

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
                "message": f"{agent_name} joined the chat.",
                "message_obj": serialize_message(self.db, saved),
                "agent_avatar": user.avatar_url,
                "agent_name": agent_name,
                "previous_agent_id": previous_agent_id,
            },
        )

        # Push the system message to all agents' open threads in real-time.
        await self.agent_service.broadcast_to_active_agents(
            website_id=conversation.website_id,
            message_data={
                "type": "system_message",
                "conversation_id": conversation_id,
                "website_id": conversation.website_id,
                "message_obj": serialize_message(self.db, saved),
            },
            include_global=True,
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

        # Fire agent_joined automation trigger (e.g. tag_with_agent_name).
        try:
            await self._run_automation_flows(
                conversation_id=conversation_id,
                website_id=int(conversation.website_id),
                trigger="agent_joined",
                log_key="agent_joined_automation_failed",
                send_to_visitor=False,
                context={"agent_name": agent_name},
            )
        except Exception:
            pass

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

        if getattr(conversation, "visitor_ended", False):
            return {"error": "Visitor has ended this conversation"}

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

        # Broadcast to spectating agents (exclude the sender – they get `message_sent` via ws_agent.py).
        await self.agent_service.broadcast_to_active_agents(
            website_id=int(conversation.website_id),
            message_data={
                "type": "agent_message",
                "conversation_id": conversation_id,
                "website_id": int(conversation.website_id),
                "message": content,
                "message_obj": message_obj,
                "agent_name": agent_name,
                "agent_avatar": agent.avatar_url if agent else None,
                "agent_id": agent_id,
            },
            include_global=True,
            exclude_agent_id=agent_id,
        )

        return {
            "success": True,
            "message_id": getattr(saved, "id", None),
            "agent_is_available": bool(getattr(agent, "is_available", False)),
            "availability_changed": availability_changed,
        }

    async def close_conversation(self, *, conversation_id: int, closed_by: str = "agent", agent_name: str | None = None) -> dict:
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
        resolved_name = agent_name or "Support"

        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="conversation_resolved",
            log_key="conversation_resolve_automation_failed",
            send_to_visitor=True,
            context={"agent_name": resolved_name},
        )

        # Safety-net: if no automation delivered show_rating_popup, send it
        # directly after a short delay.  This guarantees the visitor's widget
        # always transitions to read-only state (hides input, shows new-chat
        # button) even when no conversation_resolved automation is configured.
        asyncio.create_task(
            _fallback_resolve_notification(
                conversation_id=conversation_id,
                resolved_name=resolved_name,
            )
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

    async def visitor_left_chat(self, *, conversation_id: int) -> dict:
        """Visitor clicked 'End chat' — fires conversation_visitor_ended automation.

        Conversation stays OPEN so agents can follow up. No lead is lost.
        visitor_ended=True prevents the backend from resuming this conversation
        if the visitor reconnects and requests a fresh start.
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        # Mark that the visitor intentionally ended this conversation so a
        # subsequent "Start new chat" creates a new conversation rather than
        # resuming this one.
        try:
            conversation.visitor_ended = True
            self.db.commit()
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        # Automations handle all messaging (emit_system_event, show_rating_popup, etc.)
        # for this trigger. Nothing is hardcoded here so agents can configure the
        # flow — including wait nodes and agent-only messages — via the automation editor.
        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="conversation_visitor_ended",
            log_key="visitor_ended_automation_failed",
            send_to_visitor=True,
        )

        # Signal the agent dashboard in real-time (UI update only, no message stored).
        if website_id:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_closed_chat",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )

        return {"success": True}

    async def visitor_rated(self, *, conversation_id: int, rating_val: int) -> dict:
        """Visitor submitted a conversation rating — fires visitor_rated_conversation automation.

        Passes {rating_label} into the automation context so Bot message nodes can
        reference it, e.g. "Visitor rated this conversation: {rating_label}".
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return {"error": "Conversation not found"}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        _labels = {1: "😊 Good", 0: "😐 Neutral", -1: "😞 Bad"}
        rating_label = _labels.get(rating_val, str(rating_val))

        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_rated_conversation",
            log_key="visitor_rated_automation_failed",
            send_to_visitor=False,
            context={"rating_label": rating_label},
        )

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

        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_socket_connected",
            log_key="visitor_socket_connected_automation_failed",
            send_to_visitor=False,
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

        # If the visitor intentionally ended the chat, suppress the dropped event —
        # visitor_ended already tells the story.
        visitor_ended_exists = (
            self.db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.event_type == "visitor_ended",
            )
            .first()
        )
        if visitor_ended_exists:
            return {"success": True}

        if not self._should_record_presence_event(conversation=conversation):
            return {"success": True}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_dropped",
            log_key="visitor_dropped_automation_failed",
            send_to_visitor=False,
        )

        try:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_dropped",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )
        except Exception:
            pass

        return {"success": True}

    async def visitor_reconnected(self, *, conversation_id: int) -> dict:
        """Visitor WS reconnected after a visitor_dropped event was already fired.

        Fires the visitor_reconnected automation trigger and notifies agents.
        """
        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        except Exception:
            conversation = None

        if not conversation:
            return {"error": "Conversation not found"}

        website_id = int(getattr(conversation, "website_id", None) or 0) or None

        await self._run_automation_flows(
            conversation_id=conversation_id,
            website_id=website_id,
            trigger="visitor_reconnected",
            log_key="visitor_reconnected_automation_failed",
            send_to_visitor=False,
        )

        try:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "visitor_reconnected",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                },
                include_global=True,
            )
        except Exception:
            pass

        return {"success": True}

    async def _run_automation_flows(
        self,
        *,
        conversation_id: int,
        website_id: int | None,
        trigger: str,
        log_key: str,
        send_to_visitor: bool = True,
        context: dict | None = None,
    ) -> None:
        """Execute all enabled automation flows for a trigger.

        Walks each automation's node graph starting from the trigger node,
        dispatching action nodes by type and following edges.
        """
        if not website_id:
            return
        try:
            automation_service = AutomationService(self.db)
            automations = automation_service.list_enabled_for_trigger(
                website_id=int(website_id),
                trigger=str(trigger),
            )
            for automation in automations:
                await self._execute_flow(
                    automation=automation,
                    conversation_id=conversation_id,
                    website_id=int(website_id),
                    send_to_visitor=send_to_visitor,
                    ctx=context or {},
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

    async def _execute_flow(
        self,
        *,
        automation: Automation,
        conversation_id: int,
        website_id: int,
        send_to_visitor: bool,
        ctx: dict,
    ) -> None:
        """Walk one automation's node graph and execute each node in order."""
        nodes_list = automation.nodes or []
        edges_list = automation.edges or []
        if not nodes_list:
            return

        # Enrich ctx with conversation contact fields so any automation node
        # can reference {phone}, {email}, {visitor_name}, {contact_info} in template strings.
        # visitor_name falls back to "there" so "Hi {visitor_name}" → "Hi there" gracefully.
        # {contact_info} is built dynamically: shows whichever contact fields are filled.
        try:
            _enrich_conv = self.db.query(Conversation).filter_by(id=conversation_id).first()
            if _enrich_conv:
                ctx = dict(ctx)
                ctx.setdefault("phone", _enrich_conv.visitor_phone or "")
                ctx.setdefault("email", _enrich_conv.visitor_email or "")
                ctx.setdefault("visitor_name", _enrich_conv.visitor_name or "there")
                _p = _enrich_conv.visitor_phone or ""
                _e = _enrich_conv.visitor_email or ""
                if _p and _e:
                    ctx.setdefault("contact_info", f"{_p} or {_e}")
                elif _p:
                    ctx.setdefault("contact_info", _p)
                elif _e:
                    ctx.setdefault("contact_info", _e)
                else:
                    ctx.setdefault("contact_info", "the contact details you provided")
        except Exception:
            pass

        nodes = {n["id"]: n for n in nodes_list if isinstance(n, dict) and n.get("id")}

        # adjacency: from_id -> list of {to, branch}
        adjacency: dict[str, list[dict]] = {}
        for edge in edges_list:
            if not isinstance(edge, dict):
                continue
            frm, to = edge.get("from"), edge.get("to")
            if frm and to:
                adjacency.setdefault(frm, []).append({"to": to, "branch": edge.get("branch")})

        trigger_node = next((n for n in nodes.values() if n.get("type") == "trigger"), None)
        if not trigger_node:
            return

        # Repeat/cooldown live in the trigger node config
        trigger_cfg = trigger_node.get("config") or {}
        repeat_str = str(trigger_cfg.get("repeat") or "once").strip().lower()
        if repeat_str not in {"once", "cooldown", "always"}:
            repeat_str = "once"
        cooldown_secs: int | None = None
        if repeat_str == "cooldown":
            raw = trigger_cfg.get("cooldown_seconds")
            if raw is None:
                hours = trigger_cfg.get("cooldown_hours")
                if hours is not None:
                    try:
                        raw = int(hours) * 3600
                    except Exception:
                        pass
            if raw is not None:
                try:
                    cooldown_secs = max(1, int(raw))
                except Exception:
                    pass

        queue: list[str] = [trigger_node["id"]]
        visited: set[str] = set()

        while queue:
            node_id = queue.pop(0)
            if node_id in visited:
                continue
            visited.add(node_id)

            node = nodes.get(node_id)
            if not node:
                continue

            node_type = str(node.get("type") or "").lower()
            cfg = node.get("config") or {}
            follow_all = True

            if node_type == "trigger":
                pass  # entry point only

            elif node_type == "send_bot_message":
                message = str(cfg.get("message") or "").strip()
                event_type = str(cfg.get("event_type") or f"bot_{automation.trigger}").strip()
                node_send_to_visitor = send_to_visitor and cfg.get("send_to_visitor", True)
                if message:
                    if _should_skip_due_to_repeat(
                        db=self.db, conversation_id=conversation_id,
                        event_type=event_type, repeat=repeat_str,
                        repeat_cooldown_seconds=cooldown_secs,
                    ):
                        continue
                    # Substitute template variables ({phone}, {email}, etc.)
                    try:
                        message = message.format_map(ctx)
                    except Exception:
                        pass
                    if node_send_to_visitor:
                        saved = self.conversation_service.add_bot_message(
                            conversation_id, message, event_type=event_type
                        )
                        await ChatService.send_to_visitor(
                            conversation_id,
                            {"type": "bot", "message": message, "message_obj": serialize_message(self.db, saved)},
                        )
                    else:
                        # Agent-only bot message: stored with is_agent_only=True, never sent to visitor.
                        saved = self.conversation_service.add_system_message(
                            conversation_id, message, event_type=event_type,
                            sender="bot", is_agent_only=True,
                        )
                    # Always broadcast bot messages to agents so the dashboard reflects them.
                    await self.agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data={
                            "type": "bot_message",
                            "conversation_id": conversation_id,
                            "website_id": website_id,
                            "message_obj": serialize_message(self.db, saved),
                        },
                        include_global=True,
                    )

            elif node_type == "emit_system_event":
                raw_content = str(cfg.get("content") or "").strip()
                event_type = str(cfg.get("event_type") or automation.trigger).strip()
                if raw_content:
                    try:
                        content = raw_content.format_map(ctx)
                    except Exception:
                        content = raw_content
                    visitor_content = cfg.get("visitor_content")
                    if visitor_content and ctx:
                        try:
                            visitor_content = str(visitor_content).format_map(ctx)
                        except Exception:
                            pass
                    if _should_skip_due_to_repeat(
                        db=self.db, conversation_id=conversation_id,
                        event_type=event_type, repeat=repeat_str,
                        repeat_cooldown_seconds=cooldown_secs,
                    ):
                        continue
                    saved_evt = self.conversation_service.add_system_message(
                        conversation_id, content, event_type=event_type,
                        is_agent_only=not (send_to_visitor and cfg.get("send_to_visitor", True)),
                    )
                    msg_obj = serialize_message(self.db, saved_evt)
                    # Per-node send_to_visitor flag (default True) lets automation
                    # authors configure agent-only messages by setting it to false.
                    node_sends_to_visitor = send_to_visitor and cfg.get("send_to_visitor", True)
                    if node_sends_to_visitor:
                        visitor_text = visitor_content if visitor_content else content
                        await ChatService.send_to_visitor(
                            conversation_id,
                            {"type": "system", "event_type": event_type, "message": visitor_text,
                             "message_obj": msg_obj, "conversation_id": conversation_id, "website_id": website_id},
                        )
                    await self.agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data={"type": "system_message", "conversation_id": conversation_id,
                                      "website_id": website_id, "message_obj": msg_obj},
                        include_global=True,
                    )

            elif node_type == "wait":
                secs = int(cfg.get("seconds") or 0)
                if secs > 0:
                    await asyncio.sleep(secs)

            elif node_type == "condition":
                field = str(cfg.get("field") or "").strip()
                result = await self._evaluate_condition(field, conversation_id, website_id, ctx, cfg)
                branch_str = "true" if result else "false"
                next_ids = [e["to"] for e in adjacency.get(node_id, []) if e.get("branch") == branch_str]
                queue.extend(next_ids)
                follow_all = False

            elif node_type == "show_rating_popup":
                event_type = str(cfg.get("event_type") or "rating_popup_shown").strip()
                if _should_skip_due_to_repeat(
                    db=self.db, conversation_id=conversation_id,
                    event_type=event_type, repeat=repeat_str,
                    repeat_cooldown_seconds=cooldown_secs,
                ):
                    continue
                self.conversation_service.add_bot_message(
                    conversation_id, "__rating_popup__", event_type=event_type
                )
                if send_to_visitor:
                    await ChatService.send_to_visitor(
                        conversation_id,
                        {"type": "show_rating_popup", "conversation_id": conversation_id},
                    )

            elif node_type == "tag_conversation":
                tag_name = str(cfg.get("tag") or "").strip()
                if tag_name:
                    self._apply_tag(conversation_id=conversation_id, website_id=website_id, tag_name=tag_name)

            elif node_type == "tag_with_agent_name":
                self._apply_agent_name_tag(conversation_id=conversation_id, website_id=website_id)

            elif node_type == "bot_prompt_buttons":
                message_text = str(cfg.get("message") or "").strip()
                buttons = cfg.get("buttons") or []
                automation_id = automation.id
                if message_text:
                    validated_buttons = [
                        {"label": b["label"].strip(), "team_id": b.get("team_id"), "reply": b.get("reply", "")}
                        for b in buttons
                        if isinstance(b, dict) and (b.get("label") or "").strip()
                    ]
                    enriched = json.dumps({"message": message_text, "automation_id": automation_id, "buttons": validated_buttons})
                    saved = self.conversation_service.add_bot_message(
                        conversation_id, enriched, event_type="bot_prompt_buttons"
                    )
                    ws_payload = {
                        "type": "bot_prompt", "message": message_text,
                        "conversation_id": conversation_id, "automation_id": automation_id,
                        "buttons": validated_buttons, "message_obj": serialize_message(self.db, saved),
                    }
                    if send_to_visitor:
                        await ChatService.send_to_visitor(conversation_id, ws_payload)

            elif node_type == "end":
                break

            if follow_all:
                queue.extend(e["to"] for e in adjacency.get(node_id, []))

    async def _evaluate_condition(
        self,
        field: str,
        conversation_id: int,
        website_id: int,
        ctx: dict,
        cfg: dict | None = None,
    ) -> bool:
        """Evaluate a condition node field. Returns True/False to select branch."""
        if field == "agent_online":
            return is_website_online(website_id)
        if field == "is_first_visit":
            try:
                conv = self.db.query(Conversation).filter_by(id=conversation_id).first()
                if conv:
                    prior = (
                        self.db.query(Conversation)
                        .filter(
                            Conversation.session_id == conv.session_id,
                            Conversation.website_id == website_id,
                            Conversation.id != conversation_id,
                        )
                        .count()
                    )
                    return prior == 0
            except Exception:
                pass
            return True
        if field == "has_tag":
            tag_name = str((cfg or {}).get("value") or "").strip()
            if not tag_name:
                return False
            try:
                from app.models.tag import Tag
                from app.models.conversation_tag import ConversationTag
                tag = (
                    self.db.query(Tag)
                    .filter_by(name=tag_name, website_id=website_id)
                    .first()
                )
                if not tag:
                    return False
                return (
                    self.db.query(ConversationTag)
                    .filter_by(conversation_id=conversation_id, tag_id=tag.id)
                    .first()
                ) is not None
            except Exception:
                return False
        # Unknown field: default true
        return True

    def _apply_tag(self, *, conversation_id: int, website_id: int, tag_name: str) -> None:
        """Upsert a tag by name on the conversation (idempotent)."""
        try:
            from app.models.tag import Tag
            from app.models.conversation_tag import ConversationTag

            tag = (
                self.db.query(Tag)
                .filter_by(name=tag_name, website_id=website_id)
                .first()
            )
            if not tag:
                tag = Tag(name=tag_name, website_id=website_id, color="#6366f1")
                self.db.add(tag)
                self.db.flush()

            existing = (
                self.db.query(ConversationTag)
                .filter_by(conversation_id=conversation_id, tag_id=tag.id)
                .first()
            )
            if not existing:
                self.db.add(ConversationTag(conversation_id=conversation_id, tag_id=tag.id))
            self.db.commit()
        except Exception as e:
            logger.warning("apply_tag_failed", conversation_id=conversation_id, tag=tag_name, error=str(e))
            try:
                self.db.rollback()
            except Exception:
                pass

    def _apply_agent_name_tag(self, *, conversation_id: int, website_id: int) -> None:
        """Tag the conversation with the assigned agent's name (idempotent)."""
        try:
            conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
            if not conversation or not conversation.assigned_agent_id:
                return
            agent = self.db.query(User).filter_by(id=conversation.assigned_agent_id).first()
            if not agent or not agent.name:
                return
            tag_name = f"agent:{agent.name}"
            self._apply_tag(
                conversation_id=conversation_id,
                website_id=website_id,
                tag_name=tag_name,
            )
        except Exception as e:
            logger.warning("apply_agent_name_tag_failed", conversation_id=conversation_id, error=str(e))

    def _reattach_sockets(
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
