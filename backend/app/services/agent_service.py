from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.core.logging import get_logger
from typing import Dict, Optional
import uuid
import time

from app.repos import agent_sessions as agent_sessions_repo
from app.repos import users as users_repo
from app.infra import realtime_bus, BusEvent
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.website_team import WebsiteTeam, WebsiteTeamMember

logger = get_logger(__name__)

class AgentService:
    """Manages agent presence and message routing"""
    
    # In-memory store of active agent WebSocket connections
    active_agents: Dict[str, object] = {}

    # Heartbeat timestamps by agent_id (unix seconds). Used for presence with TTL/grace.
    last_heartbeat: Dict[int, float] = {}

    # Presence TTL: agent considered online if heartbeat within this window.
    heartbeat_ttl_seconds: int = 75

    @classmethod
    def connected_agent_ids(cls) -> set[int]:
        """Agent IDs that currently have an active websocket connection."""
        ids: set[int] = set()
        for info in cls.active_agents.values():
            try:
                agent_id = info.get("agent_id")
                if agent_id is not None:
                    ids.add(int(agent_id))
            except Exception:
                continue
        return ids

    @classmethod
    def has_active_socket(cls, agent_id: int) -> bool:
        try:
            target = int(agent_id)
        except Exception:
            return False
        for info in cls.active_agents.values():
            try:
                if int(info.get("agent_id")) == target:
                    return True
            except Exception:
                continue
        return False

    @classmethod
    def recently_active_agent_ids(cls) -> set[int]:
        """Agent IDs considered online by heartbeat TTL."""
        return {
            int(agent_id)
            for agent_id in cls.last_heartbeat.keys()
            if cls.is_recently_connected(agent_id)
        }
    
    def __init__(self, db: Session):
        self.db = db

    @classmethod
    def mark_heartbeat(cls, agent_id: int) -> None:
        cls.last_heartbeat[int(agent_id)] = time.time()

    @classmethod
    def is_recently_connected(cls, agent_id: int) -> bool:
        ts = cls.last_heartbeat.get(int(agent_id))
        if not ts:
            return False
        return (time.time() - ts) <= float(cls.heartbeat_ttl_seconds)
    
    def register_agent(self, agent_id: int, website_id: int, websocket) -> str:
        """Register agent WebSocket connection"""
        websocket_id = str(uuid.uuid4())

        # Mark presence immediately on connect.
        AgentService.mark_heartbeat(agent_id)

        # Persist heartbeat for scale-safe presence.
        try:
            users_repo.touch_last_heartbeat_at(self.db, user_id=agent_id)
            self.db.commit()
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        
        # Compute website visibility for this socket.
        # SYSTEM_MANAGER: unrestricted (sees all orgs).
        # OWNER/MANAGER: all websites within their org.
        # AGENT: only websites they are explicitly assigned to.
        visible_website_ids: list[int] | None
        try:
            user = self.db.query(User).filter(User.id == int(agent_id)).first()
            if user and user.is_administrator():
                # SYSTEM_MANAGER — no restriction at all
                visible_website_ids = None
            elif user and user.role in (UserRole.OWNER, UserRole.MANAGER) and user.organization_id is not None:
                # OWNER/MANAGER — all websites in their org
                rows = (
                    self.db.query(Website.id)
                    .filter(Website.organization_id == user.organization_id)
                    .all()
                )
                visible_website_ids = sorted({int(r[0]) for r in rows})
            else:
                # AGENT (or unknown) — only explicitly assigned websites
                rows = (
                    self.db.query(AgentWebsiteAssignment.website_id)
                    .filter(AgentWebsiteAssignment.agent_id == int(agent_id))
                    .all()
                )
                visible_website_ids = sorted({int(r[0]) for r in rows})
        except Exception:
            visible_website_ids = []

        # Compute team visibility for AGENT role.
        # None  → unrestricted (SYSTEM_MANAGER, OWNER/MANAGER, or agent with no team memberships).
        # list  → agent is a member of specific teams; only receive events for those teams.
        visible_team_ids: list[int] | None = None
        try:
            if (
                user is not None
                and user.role == UserRole.AGENT
                and visible_website_ids is not None
                and visible_website_ids
            ):
                team_rows = (
                    self.db.query(WebsiteTeamMember.team_id)
                    .join(WebsiteTeam, WebsiteTeam.id == WebsiteTeamMember.team_id)
                    .filter(WebsiteTeamMember.user_id == int(agent_id))
                    .filter(WebsiteTeam.website_id.in_(visible_website_ids))
                    .all()
                )
                team_ids_list = sorted({int(r[0]) for r in team_rows})
                # Empty list → agent not in any team → stays None (unrestricted)
                visible_team_ids = team_ids_list if team_ids_list else None
        except Exception:
            visible_team_ids = None

        # Store WebSocket connection
        AgentService.active_agents[websocket_id] = {
            "agent_id": agent_id,
            "website_id": website_id,
            "websocket": websocket,
            "visible_website_ids": visible_website_ids,
            "visible_team_ids": visible_team_ids,
            # True only for AGENT role — used to distinguish no-team agents (spectators)
            # from OWNER/MANAGER who also have visible_team_ids=None but should always
            # receive unread counts.
            "is_agent_role": user is not None and user.role == UserRole.AGENT,
        }
        
        # Create session record
        agent_sessions_repo.create_agent_session(
            self.db,
            agent_id=agent_id,
            website_id=website_id,
            websocket_id=websocket_id,
            is_online=True,
        )
        
        return websocket_id
    
    def unregister_agent(self, websocket_id: str):
        """Remove agent from active connections"""
        if websocket_id in AgentService.active_agents:
            del AgentService.active_agents[websocket_id]
        
        # Mark session offline
        agent_sessions_repo.mark_agent_session_offline(self.db, websocket_id)
    
    def assign_conversation_to_agent(self, conversation_id: int, agent_id: int):
        """Handoff conversation to agent"""
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            raise ValueError(f"Conversation {conversation_id} not found")
        
        conversation.is_handoff = True
        conversation.assigned_agent_id = agent_id
        self.db.commit()
        self.db.refresh(conversation)
        
        return conversation
    
    async def send_to_agent(self, agent_id: int, message_data: dict):
        """Send message to specific agent's WebSocket"""
        # If Redis is enabled, publish and let the subscriber deliver to whichever
        # worker actually holds the agent's websocket.
        if realtime_bus.enabled:
            await realtime_bus.publish(
                BusEvent(
                    event_type="agent_direct",
                    agent_id=int(agent_id),
                    payload=message_data,
                )
            )
            return

        logger.info("send_to_agent_attempt", agent_id=agent_id, message_type=message_data.get("type"))
        sent_count = 0
        for ws_id, agent_info in AgentService.active_agents.items():
            try:
                info_agent_id = int(agent_info.get("agent_id"))
            except Exception:
                continue

            if info_agent_id == int(agent_id):
                try:
                    await agent_info["websocket"].send_json(message_data)
                    sent_count += 1
                    logger.info("send_to_agent_success", agent_id=agent_id, ws_id=ws_id, website_id=agent_info.get("website_id"))
                except Exception as e:
                    logger.error("send_to_agent_failed", agent_id=agent_id, ws_id=ws_id, error=str(e))
        
        if sent_count == 0:
            logger.warning("send_to_agent_no_connections", agent_id=agent_id, message_type=message_data.get("type"))

    async def broadcast_to_active_agents(
        self,
        *,
        website_id: Optional[int],
        message_data: dict,
        include_global: bool = True,
        exclude_agent_id: Optional[int] = None,
        conversation_team_id: Optional[int] = None,
    ) -> int:
        """Broadcast a message to active agent sockets.

        If website_id is provided, sends to sockets connected for that website.
        If include_global is True, also sends to "global notification" sockets (website_id == 0).
        If exclude_agent_id is set, skips all sockets belonging to that agent (used to avoid
        double-delivery when the assigned agent already received the message directly).

        Returns number of sockets successfully sent.
        """
        # If Redis is enabled, publish once and let every worker deliver
        # to its locally connected sockets (prevents cross-worker misses).
        if realtime_bus.enabled:
            await realtime_bus.publish(
                BusEvent(
                    event_type="agent_broadcast",
                    website_id=website_id,
                    include_global=bool(include_global),
                    payload=message_data,
                    exclude_agent_id=exclude_agent_id,
                    conversation_team_id=conversation_team_id,
                )
            )
            return 0

        sent_count = 0

        for ws_id, agent_info in AgentService.active_agents.items():
            # Skip the excluded agent (e.g. assigned agent already received directly).
            if exclude_agent_id is not None and agent_info.get("agent_id") == exclude_agent_id:
                continue

            ws_website_id = agent_info.get("website_id")
            should_send = False

            # Enforce per-agent website visibility (agents only).
            if website_id is not None:
                visible = agent_info.get("visible_website_ids")
                if visible is not None:
                    try:
                        if int(website_id) not in set(int(x) for x in visible):
                            continue
                    except Exception:
                        continue

            # Team-scope filtering: when the conversation has a team assigned:
            # - Agents restricted to different teams → skip entirely.
            # - No-team AGENTs (visible_team_ids=None, is_agent_role=True) → spectators:
            #   they receive visitor_message (live update) but NOT conversation_unread.
            # - OWNER/MANAGER (visible_team_ids=None, is_agent_role=False) → unrestricted.
            if conversation_team_id is not None:
                team_ids = agent_info.get("visible_team_ids")
                if team_ids is not None:
                    # Agent is restricted to specific teams — skip if not matching.
                    if int(conversation_team_id) not in {int(t) for t in team_ids}:
                        continue
                elif agent_info.get("is_agent_role"):
                    # No-team AGENT — spectator: skip unread events, allow visitor_message.
                    if message_data.get("type") == "conversation_unread":
                        continue

            # A socket connected to website_id=0 is treated as a global agent socket.
            # In production we prefer a single global socket per agent, which must
            # receive website-scoped events too.
            if ws_website_id == 0 and (include_global or website_id is not None):
                should_send = True
            if website_id is not None and ws_website_id == website_id:
                should_send = True

            if not should_send:
                continue

            try:
                await agent_info["websocket"].send_json(message_data)
                sent_count += 1
            except Exception as e:
                logger.error(
                    "broadcast_to_active_agents_failed",
                    ws_id=ws_id,
                    website_id=ws_website_id,
                    error=str(e),
                )

        return sent_count

    @classmethod
    async def deliver_bus_event(cls, event: dict) -> None:
        """Deliver a Redis bus event to locally connected agent sockets."""

        event_type = event.get("event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            return

        if event_type == "agent_direct":
            try:
                target_agent_id = int(event.get("agent_id"))
            except Exception:
                return

            for agent_info in cls.active_agents.values():
                if int(agent_info.get("agent_id")) != target_agent_id:
                    continue
                try:
                    await agent_info["websocket"].send_json(payload)
                except Exception:
                    # Keep behavior consistent with existing direct send:
                    # log only at the sender side.
                    continue
            return

        if event_type == "agent_broadcast":
            website_id = event.get("website_id")
            include_global = bool(event.get("include_global", True))
            exclude_agent_id = event.get("exclude_agent_id")
            bus_conversation_team_id = event.get("conversation_team_id")

            for agent_info in cls.active_agents.values():
                # Skip the excluded agent (e.g. assigned agent already received directly).
                if exclude_agent_id is not None and agent_info.get("agent_id") == exclude_agent_id:
                    continue

                ws_website_id = agent_info.get("website_id")
                should_send = False

                if website_id is not None:
                    visible = agent_info.get("visible_website_ids")
                    if visible is not None:
                        try:
                            if int(website_id) not in set(int(x) for x in visible):
                                continue
                        except Exception:
                            continue

                # Team-scope filtering (mirrors direct broadcast path).
                if bus_conversation_team_id is not None:
                    try:
                        team_ids = agent_info.get("visible_team_ids")
                        if team_ids is not None:
                            if int(bus_conversation_team_id) not in {int(t) for t in team_ids}:
                                continue
                        elif agent_info.get("is_agent_role"):
                            # No-team AGENT — spectator: skip unread, allow visitor_message.
                            if payload.get("type") == "conversation_unread":
                                continue
                    except Exception:
                        pass

                if ws_website_id == 0 and (include_global or website_id is not None):
                    should_send = True
                if website_id is not None and ws_website_id == website_id:
                    should_send = True
                if not should_send:
                    continue
                try:
                    await agent_info["websocket"].send_json(payload)
                except Exception:
                    continue
            return
    
    async def notify_agent_assignment(self, agent_id: int, conversation_id: int):
        """Notify agent of new chat assignment"""
        await self.send_to_agent(agent_id, {
            "type": "assignment",
            "conversation_id": conversation_id,
            "message": "New chat assigned to you"
        })
    
    def get_active_chats(self, website_id: Optional[int] = None, agent_id: Optional[int] = None):
        """
        Get list of OPEN conversations visible to agents.
        
        Inbox Visibility Rules:
        - Unassigned: Visible to all eligible agents
        - Assigned: Only visible to assigned agent
        
        Args:
            website_id: Optional filter by website
            agent_id: Optional filter by assigned agent
            
        Returns:
            List of conversations
        """
        # Base query: get all OPEN conversations
        query = self.db.query(Conversation).filter(
            Conversation.status == ConversationStatus.OPEN
        )
        
        # If agent_id provided, filter for:
        # 1. Unassigned (available to claim)
        # 2. Assigned to this agent
        if agent_id:
            query = query.filter(
                (Conversation.assigned_agent_id == None) |
                (Conversation.assigned_agent_id == agent_id)
            )
        
        if website_id:
            query = query.filter(Conversation.website_id == website_id)
        
        # Stable ordering prevents inbox from "shuffling" between refreshes.
        # Use updated_at when available (TimestampMixin), fall back to created_at.
        try:
            query = query.order_by(Conversation.updated_at.desc())
        except Exception:
            query = query.order_by(Conversation.created_at.desc())

        return query.all()
    
    def get_conversation_messages(self, conversation_id: int):
        """Get all messages in a conversation"""
        return self.db.query(Message).filter_by(
            conversation_id=conversation_id
        ).order_by(Message.id).all()
