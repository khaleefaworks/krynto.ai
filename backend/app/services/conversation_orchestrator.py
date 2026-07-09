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
from app.services.website_resolver import is_team_online, is_website_online

from app.core.message_presenter import serialize_message

logger = get_logger(__name__)

# Prevent scheduling duplicate delayed "waiting" bot messages
_waiting_bot_message_scheduled: set[int] = set()

# Prevent scheduling duplicate "new chat" reminder loops (PN1)
_new_chat_reminder_scheduled: set[int] = set()

# PN1: repeat interval for the new-chat notification (sound + push) while a
# conversation sits unassigned. Agents were missing the one-shot notification,
# so this re-fires it every 15s until an agent joins.
_NEW_CHAT_REMINDER_INTERVAL_SECONDS = 15

# Sentinel for _broadcast_new_chat_to_agents: distinguishes "no hint supplied
# (read from conversation.team_id)" from an explicit None (unrouted).
_TEAM_HINT_UNSET = object()


async def _repeat_new_chat_notification_until_claimed(
    *, conversation_id: int, website_id: int, interval_seconds: int = _NEW_CHAT_REMINDER_INTERVAL_SECONDS
) -> None:
    """Re-fire the 'new chat' notification (WS + sound + push) every interval_seconds
    until an agent joins, the conversation ends, or it stops being unassigned.

    PN1: agents reported missing the sound/push for brand-new chats entirely
    (busy, tab backgrounded, etc.) since it only fired once. This keeps nagging
    every 15s — same payload as the original broadcast — until someone claims it.
    Bounded in practice by AutoCloseScheduler, which resolves stale unassigned
    conversations after 24h of inactivity.
    """
    from app.core.database import SessionLocal
    from app.models.conversation import Conversation

    try:
        while True:
            await asyncio.sleep(max(1, int(interval_seconds or 15)))

            db = SessionLocal()
            try:
                conversation = db.query(Conversation).filter_by(id=conversation_id).first()
                if (
                    not conversation
                    or conversation.assigned_agent_id
                    or conversation.status != ConversationStatus.OPEN
                    or conversation.visitor_ended
                ):
                    return

                # Visitor isn't currently connected — nagging agents about a chat
                # nobody can see them typing in is pointless noise. Skip this tick
                # but keep the loop alive: it resumes on its own the moment the
                # visitor reconnects (ChatService.active_visitors gets them back).
                if conversation_id not in ChatService.active_visitors:
                    continue

                orchestrator = ConversationOrchestrator(db)
                await orchestrator._broadcast_new_chat_to_agents(conversation, is_reminder=True)
            except Exception as e:
                logger.error(
                    "new_chat_reminder_iteration_failed",
                    conversation_id=conversation_id,
                    website_id=website_id,
                    error=str(e),
                )
            finally:
                db.close()
    finally:
        _new_chat_reminder_scheduled.discard(conversation_id)


def _get_eligible_agent_ids_for_push(
    db: Session, *, website_id: int, conversation_team_id: int | None = None
) -> set[int]:
    """Return IDs of agents who should receive push notifications.

    Scoping rules (org-aware, multi-tenant):
    - SYSTEM_MANAGER: always eligible (cross-org administrator).
    - OWNER: always eligible within their org (fully unrestricted).
    - MANAGER: team-scoped (same as AGENT per visibility rules).
      - No team memberships → unrestricted (eligible for all conversations).
      - Has team memberships → eligible only for their teams' conversations, or
        for unrouted conversations (team_id=None) which anyone can claim/route.
    - AGENT: only if directly assigned to this website via AgentWebsiteAssignment.
      - If conversation_team_id is set:
        * Members of that specific team → eligible.
        * Agents in a different team or no team → excluded (not their chat).
      - If conversation_team_id is None (unrouted conversation):
        * All assigned agents → eligible (any can claim/route it).
    - All candidates must be is_active=True AND (is_available=True OR push_when_offline=True).
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

    import sqlalchemy as sa

    # An agent is push-eligible if they are online (is_available=True) OR
    # they have opted in to offline push notifications (push_when_offline=True).
    def _push_reachable():
        return sa.or_(
            User.is_available == True,   # noqa: E712
            User.push_when_offline == True,  # noqa: E712
        )

    # SYSTEM_MANAGER — active, push-reachable system managers (cross-org)
    sys_mgrs = (
        db.query(User)
        .filter(
            User.is_active == True,   # noqa: E712
            _push_reachable(),
            User.role == UserRole.SYSTEM_MANAGER,
        )
        .all()
    )
    eligible.update(int(u.id) for u in sys_mgrs)

    if org_id is not None:
        # OWNER: fully unrestricted within their org.
        owners = (
            db.query(User)
            .filter(
                User.is_active == True,   # noqa: E712
                _push_reachable(),
                User.organization_id == org_id,
                User.role == UserRole.OWNER,
            )
            .all()
        )
        eligible.update(int(u.id) for u in owners)

        # MANAGER: team-scoped (mirrors compute_visibility_scope / WS delivery logic).
        # Fetch all managers first, then filter by team membership in one batch query.
        managers = (
            db.query(User)
            .filter(
                User.is_active == True,   # noqa: E712
                _push_reachable(),
                User.organization_id == org_id,
                User.role == UserRole.MANAGER,
            )
            .all()
        )
        if managers:
            mgr_ids = {int(m.id) for m in managers}
            mgr_team_rows = (
                db.query(WebsiteTeamMember.user_id, WebsiteTeamMember.team_id)
                .join(WebsiteTeam, WebsiteTeam.id == WebsiteTeamMember.team_id)
                .join(Website, Website.id == WebsiteTeam.website_id)
                .filter(WebsiteTeamMember.user_id.in_(mgr_ids))
                .filter(Website.organization_id == org_id)
                .all()
            )
            mgr_to_teams: dict[int, set[int]] = {mid: set() for mid in mgr_ids}
            for row_user_id, row_team_id in mgr_team_rows:
                mgr_to_teams[int(row_user_id)].add(int(row_team_id))

            for mgr in managers:
                mgr_teams = mgr_to_teams[int(mgr.id)]
                if not mgr_teams:
                    # No team membership: eligible only for unrouted conversations.
                    # Team-routed conversations skip no-team managers — they have no
                    # ownership of another team's chat (mirrors AGENT no-team rule).
                    if conversation_team_id is None:
                        eligible.add(int(mgr.id))
                elif conversation_team_id is None:
                    # Unrouted conversation → notify all managers (anyone can route it).
                    eligible.add(int(mgr.id))
                elif int(conversation_team_id) in mgr_teams:
                    eligible.add(int(mgr.id))

    # AGENT: must be directly assigned to this website
    assigned_rows = (
        db.query(AgentWebsiteAssignment.agent_id)
        .filter(AgentWebsiteAssignment.website_id == website_id)
        .all()
    )
    assigned_agent_ids = {int(r[0]) for r in assigned_rows}

    if assigned_agent_ids:
        if conversation_team_id is not None:
            # Conversation is routed to a specific team.
            # Only members of that exact team are eligible — no-team agents are
            # excluded because this conversation is not in their area of responsibility.
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
                    _push_reachable(),
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


def _resolve_button_at_path(
    top_buttons: list, path: list[int]
) -> tuple[dict | None, dict | None]:
    """Walk *path* through nested sub_prompt.buttons to find the target button.

    Returns ``(button_dict, parent_sub_prompt_dict_or_None)``.
    *parent_sub_prompt_dict* is the sub_prompt config that owns the target button;
    it is ``None`` for top-level buttons.
    """
    if not path:
        return None, None
    current_list: list = top_buttons
    parent_sub: dict | None = None
    btn: dict | None = None
    for depth, step in enumerate(path):
        if not isinstance(current_list, list) or step < 0 or step >= len(current_list):
            return None, None
        item = current_list[step]
        if not isinstance(item, dict):
            return None, None
        btn = item
        if depth < len(path) - 1:
            # Descend into sub_prompt for the next step
            sub = btn.get("sub_prompt")
            if not sub or not isinstance(sub, dict):
                return None, None
            parent_sub = sub
            current_list = sub.get("buttons") or []
        # For the last step `parent_sub` stays from the previous iteration
    return btn, parent_sub


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
            # Also honour team-level offline: if the conversation was routed to
            # a specific team and that team has no available agents, the same
            # offline path applies even if the website is globally online.
            _team_id = getattr(conversation, "team_id", None)
            _effective_online = (
                is_team_online(int(_team_id))
                if _team_id is not None
                else is_website_online(website_id)
            )
            if not _effective_online:
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


async def _close_bot_conversation_after_delay(
    *,
    conversation_id: int,
    website_id: int,
    delay_seconds: int,
) -> None:
    """Wait delay_seconds then silently resolve a bot-only conversation.

    Sends bot_conversation_complete to the visitor (no rating popup, no system
    message) and conversation_closed to agents so the dashboard list updates.
    If the process restarts before this fires the startup reconciliation job
    handles the cleanup.
    """
    try:
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation, ConversationStatus
        from app.services.chat_service import ChatService

        await asyncio.sleep(max(1, int(delay_seconds or 3)))

        db = SessionLocal()
        try:
            conversation = db.query(Conversation).filter_by(id=conversation_id).first()
            if not conversation or conversation.status == ConversationStatus.RESOLVED:
                return

            conversation.status = ConversationStatus.RESOLVED
            conversation.closed_by = "bot"
            conversation.resolved_at = datetime.utcnow()
            db.commit()

            # Notify visitor so widget can clear its state silently.
            try:
                await ChatService.send_to_visitor(
                    conversation_id,
                    {"type": "bot_conversation_complete", "conversation_id": conversation_id},
                )
            except Exception:
                pass

            # Notify agents so the conversation disappears from the Bot filter.
            orchestrator = ConversationOrchestrator(db)
            await orchestrator.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data={
                    "type": "conversation_closed",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                    "closed_by": "bot",
                },
                include_global=True,
                conversation_team_id=getattr(conversation, "team_id", None),
            )
            logger.info(
                "bot_conversation_auto_resolved",
                conversation_id=conversation_id,
                delay_seconds=delay_seconds,
            )
        finally:
            db.close()
    except Exception as e:
        logger.error(
            "bot_conversation_auto_resolve_failed",
            conversation_id=conversation_id,
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

        # bot-only conversations generate no agent notifications — skip all paths.
        if getattr(conversation, "bot_only", False):
            return None

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
                    loop = asyncio.get_running_loop()
                    loop.run_in_executor(
                        None,
                        lambda: send_web_push_to_subscriptions(
                            subscriptions=subs,
                            title=f"New message in conversation #{conversation.short_id}",
                            body=(message or "New message")[:120],
                            url=f"/dashboard/chats/{conversation.short_id}",
                            push_type="new_message",
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
                    loop = asyncio.get_running_loop()
                    loop.run_in_executor(
                        None,
                        lambda: send_web_push_to_subscriptions(
                            subscriptions=subs,
                            title="New message",
                            body=(message or "New message")[:120],
                            url=f"/dashboard/chats/{conversation.short_id}",
                            push_type="new_message",
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
            self._maybe_schedule_new_chat_reminder(conversation_id=conversation.id, website_id=website_id)

        # No agent assigned yet.
        # If nobody is online, accept the message (leave-a-message flow).
        # Fire website_offline_first_message once per conversation regardless
        # of whether this is the first message — covers the mid-conversation
        # case where the website goes offline after a chat has started.
        # The automation's repeat=once policy prevents duplicate sends.
        # Team-aware offline check: if the conversation is routed to a specific
        # team, check whether that team has any available agent.  Fall back to
        # the website-level check for unrouted conversations.
        _team_id_vm = getattr(conversation, "team_id", None)
        _is_offline_vm = (
            not is_team_online(int(_team_id_vm))
            if _team_id_vm is not None
            else not is_website_online(website_id)
        )
        if _is_offline_vm and not conversation.assigned_agent_id:
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
    
    async def _broadcast_new_chat_to_agents(
        self, conversation: Conversation, _team_id_hint=_TEAM_HINT_UNSET, *, is_reminder: bool = False
    ):
        """Notify all connected agents about new unassigned chat via global notification socket.

        _team_id_hint: when provided, overrides conversation.team_id for push/WS scoping.
        Used by handle_bot_button_click which knows the intended team before the DB write.
        is_reminder: True for PN1's repeat calls — swaps the push copy from "New chat"
        to "still waiting to be claimed" wording so a repeat doesn't read as a duplicate
        of the same alert (and isn't mistaken for an actual second new chat).
        """
        # Only broadcast if conversation is still open and unassigned
        if conversation.status != ConversationStatus.OPEN or conversation.assigned_agent_id:
            return

        # Snapshot which agents are currently available so analytics can later prove
        # who was online when this chat arrived.
        try:
            from app.models.website import Website as _Website
            from app.models.user import User as _User
            _site = self.db.query(_Website).filter_by(id=conversation.website_id).first()
            if _site and _site.organization_id:
                _online = (
                    self.db.query(_User.id, _User.name)
                    .filter(
                        _User.organization_id == _site.organization_id,
                        _User.is_available == True,  # noqa: E712
                        _User.is_active == True,      # noqa: E712
                    )
                    .all()
                )
                conversation.agents_online_snapshot = json.dumps(
                    [{"id": r.id, "name": r.name} for r in _online]
                )
                self.db.commit()
        except Exception:
            pass  # never let snapshot failure block notification delivery

        # Get website info
        from app.models.website import Website
        website = self.db.query(Website).filter_by(id=conversation.website_id).first()
        website_name = website.name if website else f"Website {conversation.website_id}"

        # Get last message
        last_msg = self.db.query(Message).filter_by(
            conversation_id=conversation.id
        ).order_by(Message.created_at.desc()).first()
        last_message = last_msg.content if last_msg else "New conversation"

        # Use the caller-supplied hint when available (button click path knows the
        # intended team before the DB write; conversation.team_id is still None then).
        _new_chat_team_id = (
            getattr(conversation, "team_id", None)
            if _team_id_hint is _TEAM_HINT_UNSET
            else _team_id_hint
        )
        await self.agent_service.broadcast_to_active_agents(
            website_id=conversation.website_id,
            message_data={
                "type": "new_chat",
                "conversation_id": conversation.id,
                "website_id": conversation.website_id,
                "website_name": website_name,
                "session_id": conversation.session_id,
                "last_message": last_message,
                "status": conversation.status.value,
                "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
                "is_reminder": is_reminder,
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
                push_title = "Chat waiting to be claimed" if is_reminder else "New chat"
                push_body = (
                    f"Still unclaimed — {website_name}" if is_reminder else (last_message or "New conversation")
                )[:120]
                loop = asyncio.get_running_loop()
                loop.run_in_executor(
                    None,
                    lambda: send_web_push_to_subscriptions(
                        subscriptions=subs,
                        title=push_title,
                        body=push_body,
                        url=f"/dashboard/chats/{conversation.short_id}" if conversation.short_id else "/dashboard/chats",
                        push_type="new_chat",
                    ),
                )
        except Exception:
            pass

    def _maybe_schedule_new_chat_reminder(self, *, conversation_id: int, website_id: int) -> None:
        """Schedule the PN1 repeat-notification loop, if enabled for this website.

        Configurable via the 'new_chat_unclaimed' automation's
        repeat_new_chat_notification action node — its interval_seconds sets
        the repeat interval, same as any other node's config. Disabling the
        automation (or removing the node) turns the repeat off entirely — the
        initial one-shot broadcast (already sent by the caller) still fires.
        """
        if conversation_id in _new_chat_reminder_scheduled:
            return
        automation_service = AutomationService(self.db)
        actions = automation_service.get_actions_by_type(
            website_id=website_id, trigger="new_chat_unclaimed", action_type="repeat_new_chat_notification"
        )
        if not actions:
            return
        try:
            interval = int(actions[0].get("interval_seconds") or _NEW_CHAT_REMINDER_INTERVAL_SECONDS)
        except (TypeError, ValueError):
            interval = _NEW_CHAT_REMINDER_INTERVAL_SECONDS
        _new_chat_reminder_scheduled.add(conversation_id)
        asyncio.create_task(
            _repeat_new_chat_notification_until_claimed(
                conversation_id=conversation_id,
                website_id=website_id,
                interval_seconds=interval,
            )
        )

    async def _notify_agents_like_message(
        self,
        *,
        conversation: Conversation,
        website_id: int,
        title: str,
        body: str,
        event_type: str,
    ) -> None:
        """Generic 'notify agents like a new message' signal (sound + push).

        Any automation node can opt into this via node config `show_notification:
        true`. Mirrors the exact assigned/unassigned delivery pattern used for
        regular visitor messages in handle_visitor_message, so it behaves
        identically from an agent's point of view — same push eligibility rules,
        same WS scoping. Emits a dedicated `automation_notification` WS type
        (not `visitor_message`/`system_message`) so it can't be mistaken for a
        real chat message or double-count unread badges; the frontend just uses
        it as a cue to play the agent's own "message" sound preference.
        """
        conv_team_id = getattr(conversation, "team_id", None)
        assigned_agent_id = getattr(conversation, "assigned_agent_id", None)

        payload = {
            "type": "automation_notification",
            "conversation_id": conversation.id,
            "website_id": website_id,
            "event_type": event_type,
            "title": title,
            "body": body,
            "_assigned_agent_id": assigned_agent_id,
        }

        if assigned_agent_id:
            await self.agent_service.send_to_agent(assigned_agent_id, payload)
            push_agent_ids = {assigned_agent_id}
        else:
            await self.agent_service.broadcast_to_active_agents(
                website_id=website_id,
                message_data=payload,
                include_global=True,
                conversation_team_id=conv_team_id,
            )
            push_agent_ids = _get_eligible_agent_ids_for_push(
                self.db, website_id=website_id, conversation_team_id=conv_team_id
            )

        try:
            from app.repos import push_subscriptions as push_subs_repo
            from app.services.push_service import send_web_push_to_subscriptions

            subs = push_subs_repo.list_subscriptions_for_agents(self.db, agent_ids=push_agent_ids)
            if subs:
                loop = asyncio.get_running_loop()
                loop.run_in_executor(
                    None,
                    lambda: send_web_push_to_subscriptions(
                        subscriptions=subs,
                        title=title,
                        body=body,
                        url=f"/dashboard/chats/{conversation.short_id}" if conversation.short_id else "/dashboard/chats",
                        push_type="new_message",
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
        button_index: int = 0,
        button_path: list[int] | None = None,
        visitor_ws: Any | None = None,
    ) -> dict | None:
        """Handle a visitor clicking on a bot prompt button.

        ``button_path`` is the authoritative navigation key — a list of indices
        that walks through nested sub_prompt.buttons trees.  ``button_index`` is
        the legacy scalar equivalent; when ``button_path`` is absent it is
        converted to ``[button_index]``.

        Behaviour depends on whether the resolved button is a *branch* (has a
        ``sub_prompt`` config) or a *leaf* (no sub_prompt):

        * **Branch**: persists the visitor's selection, broadcasts it to agents,
          sends a new ``bot_prompt`` WS event so the widget renders the next
          level of buttons.  Does NOT assign a team or fire automation_complete.
        * **Leaf**: full existing behaviour — team assign, reply, automation_complete,
          waiting-message timer — plus optional ``suppress_waiting_message``.
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
        if not isinstance(buttons, list) or not buttons:
            logger.warning("bot_button_click_no_buttons", automation_id=automation_id)
            return None

        # Resolve path (prefer button_path; fall back to [button_index])
        path: list[int] = button_path if button_path is not None else [button_index]
        button, parent_sub_prompt = _resolve_button_at_path(buttons, path)
        if button is None:
            logger.warning(
                "bot_button_click_invalid_path",
                automation_id=automation_id,
                button_path=path,
            )
            return None

        label = button.get("label", "")
        team_id = button.get("team_id")
        reply = button.get("reply", "")

        result = {
            "label": label,
            "team_id": None,
            "team_name": None,
        }

        # Compute bot_only early so all broadcast guards use it before any DB write.
        # Checks (in priority order):
        #  1. conversation already flagged (e.g. branch click already marked it)
        #  2. button itself has bot_only (leaf OR branch button)
        #  3. parent sub_prompt has bot_only (leaf inherits from parent branch)
        #  4. this button IS a branch and its sub_prompt has bot_only (marks entire branch)
        _sub_prompt_cfg_early = button.get("sub_prompt") if isinstance(button.get("sub_prompt"), dict) else None
        _is_bot_only = bool(
            getattr(conversation, "bot_only", False)
            or button.get("bot_only")
            or (parent_sub_prompt and parent_sub_prompt.get("bot_only"))
            or (_sub_prompt_cfg_early and _sub_prompt_cfg_early.get("bot_only"))
        )

        # Resolve the team this button will assign from config, before any DB write.
        # Both new_chat broadcast and visitor_message broadcast need the correct team
        # for scoping — but the actual conversation.team_id write happens later in the
        # branch/leaf paths below. Without this hint both broadcasts see team_id=None
        # and send push + sound to every agent on the website.
        _button_team_id: int | None = None
        if team_id is not None:
            try:
                _button_team_id = int(team_id)
            except (TypeError, ValueError):
                pass

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

        # new_chat broadcast is deferred to the LEAF section below.
        # Branch clicks (sub-prompt navigation) must not trigger it — the visitor
        # hasn't made their actual selection yet, and sub-prompts often route to
        # teams with no members at that stage.  The leaf path uses a path-depth
        # formula to fire on the first real leaf action regardless of how many
        # branch-navigation messages were saved before it.

        # Broadcast the visitor's button click to agents (skipped for bot-only paths).
        if visitor_selection_msg and not _is_bot_only:
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
                    conversation_team_id=_button_team_id,
                )

        # ── Branch button: has a sub_prompt → show next level of buttons ────────
        sub_prompt_cfg = button.get("sub_prompt")
        if sub_prompt_cfg and isinstance(sub_prompt_cfg, dict):
            # Assign team immediately on branch click (so agents see the routing
            # before the visitor picks a sub-option).
            branch_team_id = button.get("team_id")
            if branch_team_id is not None:
                try:
                    from app.models.website_team import WebsiteTeam as _WsTeam

                    _t = self.db.query(_WsTeam).filter_by(id=int(branch_team_id)).first()
                    if _t and int(_t.website_id) == int(conversation.website_id):
                        conversation.team_id = _t.id
                        self.db.commit()
                        result["team_id"] = _t.id
                        result["team_name"] = _t.name
                        await self.agent_service.broadcast_to_active_agents(
                            website_id=int(conversation.website_id),
                            message_data={
                                "type": "conversation_team_changed",
                                "conversation_id": conversation.id,
                                "website_id": int(conversation.website_id),
                                "team_id": _t.id,
                            },
                            include_global=True,
                            conversation_team_id=None,
                        )
                        logger.info(
                            "bot_branch_team_assigned",
                            conversation_id=conversation.id,
                            team_id=_t.id,
                            button_label=label,
                        )
                except Exception as _e:
                    logger.error("bot_branch_team_assign_failed", error=str(_e))

            sub_message = str(sub_prompt_cfg.get("message") or "").strip()
            sub_buttons_raw: list = sub_prompt_cfg.get("buttons") or []
            sub_allow_input: bool = bool(sub_prompt_cfg.get("allow_input", False))
            # collect_contact: False on a sub_prompt means its leaf buttons never
            # show the offline contact form (e.g. informational / Jobs path).
            sub_collect_contact: bool = bool(sub_prompt_cfg.get("collect_contact", True))
            if sub_message and sub_buttons_raw:
                sub_validated = []
                for b in sub_buttons_raw:
                    if not (isinstance(b, dict) and (b.get("label") or "").strip()):
                        continue
                    _stid = b.get("team_id")
                    _s_is_leaf = not b.get("sub_prompt")
                    # Per-button flag overrides the sub_prompt-level default.
                    _s_collect = bool(b.get("collect_contact", sub_collect_contact))
                    sub_validated.append({
                        "label": b["label"].strip(),
                        "team_id": _stid,
                        "reply": b.get("reply", ""),
                        "team_online": is_team_online(int(_stid)) if (_stid and _s_is_leaf and _s_collect) else None,
                        "collect_contact": _s_collect,
                        "is_branch": not _s_is_leaf,
                    })
                # Persist the sub-prompt as a bot message so agents can see it
                sub_enriched = json.dumps({
                    "message": sub_message,
                    "automation_id": automation_id,
                    "buttons": sub_validated,
                })
                sub_saved = self.conversation_service.add_bot_message(
                    conversation.id, sub_enriched, event_type="bot_prompt_buttons"
                )
                sub_ws_payload = {
                    "type": "bot_prompt",
                    "message": sub_message,
                    "conversation_id": conversation.id,
                    "automation_id": automation_id,
                    "buttons": sub_validated,
                    "allow_input": sub_allow_input,
                    "button_path_prefix": path,
                    "message_obj": serialize_message(self.db, sub_saved),
                }
                await ChatService.send_bot_message_to_visitor(
                    conversation.id, sub_ws_payload, visitor_ws=visitor_ws
                )
                logger.info(
                    "bot_sub_prompt_sent",
                    conversation_id=conversation.id,
                    parent_path=path,
                    sub_buttons=len(sub_validated),
                )
                # Mark conversation as bot_only immediately on branch click so it
                # never appears in All/Mine/Unassigned, even before the leaf fires.
                if _is_bot_only and not getattr(conversation, "bot_only", False):
                    try:
                        conversation.bot_only = True
                        self.db.commit()
                    except Exception as _e:
                        logger.error("bot_only_flag_set_branch_failed", error=str(_e))
                        try:
                            self.db.rollback()
                        except Exception:
                            pass
                return {"label": label, "team_id": None, "team_name": None, "sub_prompt": True}

        # ── Leaf button: team assign + reply + automation_complete ────────────

        # _is_bot_only was computed early (above) so all broadcast guards saw it.
        _resolve_delay = int(
            button.get("resolve_delay_seconds")
            or (parent_sub_prompt and parent_sub_prompt.get("resolve_delay_seconds"))
            or 3
        )

        # Determine if waiting message should be suppressed for this leaf click.
        # Priority: bot_only (always suppresses) → button-level flag → parent sub_prompt flag.
        suppress_waiting = bool(
            _is_bot_only
            or button.get("suppress_waiting_message")
            or (parent_sub_prompt and parent_sub_prompt.get("suppress_waiting_message"))
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

                    # Broadcast team change to agents (no team filter — all agents need to know).
                    await self.agent_service.broadcast_to_active_agents(
                        website_id=int(conversation.website_id),
                        message_data={
                            "type": "conversation_team_changed",
                            "conversation_id": conversation.id,
                            "website_id": int(conversation.website_id),
                            "team_id": team.id,
                        },
                        include_global=True,
                        conversation_team_id=None,
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

        # Mark conversation as bot-only before any broadcast so all checks see the flag.
        if _is_bot_only and not getattr(conversation, "bot_only", False):
            try:
                conversation.bot_only = True
                self.db.commit()
            except Exception as _e:
                logger.error("bot_only_flag_set_failed", error=str(_e))
                try:
                    self.db.rollback()
                except Exception:
                    pass

        # Fire new_chat broadcast on the first LEAF action.
        # Skipped entirely for bot-only conversations — no agent is ever notified.
        # For regular paths: depth formula fires exactly once on the first leaf click.
        if not _is_bot_only and prior_visitor_msg_count <= len(path) - 1:
            await self._broadcast_new_chat_to_agents(conversation, _team_id_hint=_button_team_id)
            self._maybe_schedule_new_chat_reminder(conversation_id=conversation.id, website_id=int(conversation.website_id))

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

            await ChatService.send_bot_message_to_visitor(
                conversation.id, reply_payload, visitor_ws=visitor_ws
            )

        # IVR complete: the visitor has made their selection and the conversation
        # continues normally, so always open the text input.
        # NOTE: allow_input on the bot_prompt node governs typing *during*
        # button display (concurrent free text).  It must not gate the input
        # *after* the leaf is clicked — that would permanently lock the visitor
        # out of the chat.
        try:
            await ChatService.send_to_visitor(
                conversation.id,
                {
                    "type": "automation_complete",
                    "conversation_id": conversation.id,
                    # suppress_waiting_message=True signals an informational path
                    # (e.g. Jobs) where no agent handoff is expected; keep input
                    # locked so the visitor knows there's nothing to reply to.
                    "allow_input": not suppress_waiting,
                },
            )
        except Exception:
            pass

        # bot-only path: skip all offline/waiting logic and schedule silent auto-resolve.
        if _is_bot_only:
            _waiting_bot_message_scheduled.discard(conversation.id)
            asyncio.create_task(
                _close_bot_conversation_after_delay(
                    conversation_id=conversation.id,
                    website_id=int(conversation.website_id),
                    delay_seconds=_resolve_delay,
                )
            )
            return result

        # If the website (or the routed team) is offline and no agent is
        # assigned, fire the offline prompt immediately.  The repeat=once
        # policy prevents duplicates.  Skip the waiting-message timer since
        # it would contradict the offline message.
        # Team-aware: a button that routes to a specific team uses that team's
        # availability rather than the global website availability.
        _team_id_btn = getattr(conversation, "team_id", None)
        _is_offline_btn = (
            not is_team_online(int(_team_id_btn))
            if _team_id_btn is not None
            else not is_website_online(int(conversation.website_id))
        )
        if not suppress_waiting and not conversation.assigned_agent_id and _is_offline_btn:
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
        elif (
            not suppress_waiting
            and not conversation.assigned_agent_id
            and conversation.id not in _waiting_bot_message_scheduled
        ):
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

        _join_team_id = getattr(conversation, "team_id", None)

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
            conversation_team_id=_join_team_id,
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
            conversation_team_id=_join_team_id,
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

        _takeover_team_id = getattr(conversation, "team_id", None)

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
            conversation_team_id=_takeover_team_id,
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
            conversation_team_id=_takeover_team_id,
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
            conversation_team_id=getattr(conversation, "team_id", None),
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
            conversation_team_id=getattr(conversation, "team_id", None),
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
                conversation_team_id=getattr(conversation, "team_id", None),
            )

        return {"success": True}

    async def visitor_rated(
        self, *, conversation_id: int, rating_val: int, feedback: str | None = None
    ) -> dict:
        """Visitor submitted a conversation rating — fires visitor_rated_conversation automation.

        Passes {rating_label} into the automation context so Bot message nodes can
        reference it, e.g. "Visitor rated this conversation: {rating_label}".
        If the visitor also left a text comment, a second bot message is added and
        broadcast to agents so it appears immediately in the conversation thread.
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

        # If the visitor left a text comment, add it as an agent-only bot message
        # (same visibility as the rating message — agents see it, visitor does not).
        feedback_text = (feedback or "").strip()
        if feedback_text:
            saved = self.conversation_service.add_system_message(
                conversation_id,
                f'Visitor comment: "{feedback_text}"',
                event_type="rating_feedback",
                sender="bot",
                is_agent_only=True,
            )
            try:
                await self.agent_service.broadcast_to_active_agents(
                    website_id=website_id,
                    message_data={
                        "type": "system_message",
                        "conversation_id": conversation_id,
                        "website_id": website_id,
                        "message_obj": serialize_message(self.db, saved),
                    },
                    include_global=True,
                    conversation_team_id=getattr(conversation, "team_id", None),
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
                conversation_team_id=getattr(conversation, "team_id", None),
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
                conversation_team_id=getattr(conversation, "team_id", None),
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
                conversation_team_id=getattr(conversation, "team_id", None),
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

        # Fetch conversation once for ctx enrichment and team_id scoping.
        _conv_team_id: int | None = None
        _enrich_conv: Conversation | None = None
        try:
            _enrich_conv = self.db.query(Conversation).filter_by(id=conversation_id).first()
            if _enrich_conv:
                _conv_team_id = getattr(_enrich_conv, "team_id", None)
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

            elif node_type == "repeat_new_chat_notification":
                pass  # config carrier only (PN1) — interval_seconds is read directly
                      # by _maybe_schedule_new_chat_reminder, not executed here. The
                      # repeat itself is a background asyncio loop, not a graph walk.

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
                        await ChatService.send_bot_message_to_visitor(
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
                        conversation_team_id=_conv_team_id,
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
                        visitor_payload = {
                            "type": "system", "event_type": event_type, "message": visitor_text,
                            "message_obj": msg_obj, "conversation_id": conversation_id, "website_id": website_id,
                        }
                        # emit_system_event covers both real chat-bubble content and
                        # pure timeline banners (e.g. "resolved"/"visitor ended").
                        # Only the former ever reaches the widget's notifyNewMessage()
                        # to clear a pending chatbot_pending dot — sending the marker
                        # ahead of a banner (kind == "event") would leave the launcher
                        # dot stuck forever, since nothing on the client consumes it.
                        if msg_obj.get("kind") == "chat":
                            await ChatService.send_bot_message_to_visitor(conversation_id, visitor_payload)
                        else:
                            await ChatService.send_to_visitor(conversation_id, visitor_payload)
                    await self.agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data={"type": "system_message", "conversation_id": conversation_id,
                                      "website_id": website_id, "message_obj": msg_obj},
                        include_global=True,
                        conversation_team_id=_conv_team_id,
                    )

                    # Opt-in per-node setting: also nag agents with sound + push,
                    # same as a regular message, instead of just a silent transcript entry.
                    if cfg.get("show_notification") and _enrich_conv is not None:
                        try:
                            await self._notify_agents_like_message(
                                conversation=_enrich_conv,
                                website_id=website_id,
                                title=f"Conversation #{_enrich_conv.short_id}" if getattr(_enrich_conv, "short_id", None) else "Conversation update",
                                body=content,
                                event_type=event_type,
                            )
                        except Exception as e:
                            logger.warning("automation_show_notification_failed", conversation_id=conversation_id, error=str(e))

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
                    validated_buttons = []
                    for b in buttons:
                        if not (isinstance(b, dict) and (b.get("label") or "").strip()):
                            continue
                        _tid = b.get("team_id")
                        # Only stamp team_online on leaf buttons (no sub_prompt).
                        # Branch buttons must never be intercepted — the visitor
                        # needs to navigate deeper before a team is actually assigned.
                        _is_leaf = not b.get("sub_prompt")
                        # collect_contact=False on a button disables the offline
                        # contact form for that specific button/path.
                        _collect_contact = bool(b.get("collect_contact", True))
                        validated_buttons.append({
                            "label": b["label"].strip(),
                            "team_id": _tid,
                            "reply": b.get("reply", ""),
                            "team_online": is_team_online(int(_tid)) if (_tid and _is_leaf and _collect_contact) else None,
                            "collect_contact": _collect_contact,
                            "is_branch": not _is_leaf,
                        })
                    enriched = json.dumps({"message": message_text, "automation_id": automation_id, "buttons": validated_buttons})
                    saved = self.conversation_service.add_bot_message(
                        conversation_id, enriched, event_type="bot_prompt_buttons"
                    )
                    ws_payload = {
                        "type": "bot_prompt", "message": message_text,
                        "conversation_id": conversation_id, "automation_id": automation_id,
                        "buttons": validated_buttons,
                        "allow_input": bool(cfg.get("allow_input", False)),
                        "button_path_prefix": [],
                        "message_obj": serialize_message(self.db, saved),
                    }
                    if send_to_visitor:
                        await ChatService.send_bot_message_to_visitor(conversation_id, ws_payload)

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
