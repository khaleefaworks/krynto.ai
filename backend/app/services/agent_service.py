from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.core.logging import get_logger
from typing import Dict, Optional
import uuid
import time

from app.repos import agent_sessions as agent_sessions_repo
from app.repos import users as users_repo

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
        
        # Store WebSocket connection
        AgentService.active_agents[websocket_id] = {
            "agent_id": agent_id,
            "website_id": website_id,
            "websocket": websocket
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
        logger.info("send_to_agent_attempt", agent_id=agent_id, message_type=message_data.get("type"))
        sent_count = 0
        for ws_id, agent_info in AgentService.active_agents.items():
            if agent_info["agent_id"] == agent_id:
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
    ) -> int:
        """Broadcast a message to active agent sockets.

        If website_id is provided, sends to sockets connected for that website.
        If include_global is True, also sends to "global notification" sockets (website_id == 0).

        Returns number of sockets successfully sent.
        """
        sent_count = 0

        for ws_id, agent_info in AgentService.active_agents.items():
            ws_website_id = agent_info.get("website_id")
            should_send = False

            if include_global and ws_website_id == 0:
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
        ).order_by(Message.created_at).all()
