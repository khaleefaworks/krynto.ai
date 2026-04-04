import asyncio
from typing import Dict, Set

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.website import Website
from app.models.user import User, UserRole
from app.repos import users as users_repo
from app.services.agent_resolver import is_agent_eligible
from app.services.office_hours import is_within_office_hours

logger = get_logger(__name__)


class PresenceService:
    """Tracks widget presence websocket connections and broadcasts updates.

    Presence is computed from DB-backed heartbeat + availability flags so it works
    across workers (when heartbeats are persisted).

    This is used to make availability toggles effectively instant for visitors.
    """

    _lock = asyncio.Lock()
    _connections: Dict[int, Set[WebSocket]] = {}

    @classmethod
    async def register(cls, website_id: int, websocket: WebSocket) -> None:
        async with cls._lock:
            cls._connections.setdefault(int(website_id), set()).add(websocket)

    @classmethod
    async def unregister(cls, website_id: int, websocket: WebSocket) -> None:
        async with cls._lock:
            ws_set = cls._connections.get(int(website_id))
            if not ws_set:
                return
            ws_set.discard(websocket)
            if not ws_set:
                cls._connections.pop(int(website_id), None)

    @classmethod
    async def _snapshot(cls, website_id: int) -> dict:
        db = SessionLocal()
        try:
            return cls.compute_presence(db, website_id)
        finally:
            try:
                db.close()
            except Exception:
                pass

    @staticmethod
    def compute_presence(db: Session, website_id: int) -> dict:
        website = db.query(Website).filter_by(id=int(website_id)).first()
        if not website:
            return {
                "type": "presence",
                "website_id": int(website_id),
                "online": False,
                "available_agents_count": 0,
                "agents": [],
            }

        # Office hours gate: force offline outside schedule.
        if not is_within_office_hours(getattr(website, "widget_config", None) or {}):
            return {
                "type": "presence",
                "website_id": int(website_id),
                "online": False,
                "available_agents_count": 0,
                "agents": [],
            }

        # Presence is heartbeat-based so it can scale beyond a single worker.
        connected_user_ids = users_repo.recently_heartbeat_user_ids(
            db,
            ttl_seconds=75,
        )

        assignment_rows = (
            db.query(AgentWebsiteAssignment.agent_id)
            .filter(AgentWebsiteAssignment.website_id == int(website_id))
            .all()
        )
        assigned_agent_ids = sorted({int(r[0]) for r in assignment_rows})
        if not assigned_agent_ids:
            return {
                "type": "presence",
                "website_id": int(website_id),
                "online": False,
                "available_agents_count": 0,
                "agents": [],
            }

        candidates = (
            db.query(User)
            .filter(
                User.id.in_(assigned_agent_ids),
                User.is_active == True,  # noqa: E712
                User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER]),
            )
            .all()
        )

        online_agents = [
            {
                "id": u.id,
                "name": u.name or "Support",
                "avatar_url": u.avatar_url,
            }
            for u in candidates
            if is_agent_eligible(u, u.id in connected_user_ids)
        ]

        available_agents_count = len(online_agents)

        return {
            "type": "presence",
            "website_id": int(website_id),
            "online": available_agents_count > 0,
            "available_agents_count": available_agents_count,
            "agents": online_agents[:3],
        }

    @classmethod
    async def broadcast(cls, website_id: int) -> None:
        website_id_int = int(website_id)
        async with cls._lock:
            targets = list(cls._connections.get(website_id_int, set()))

        if not targets:
            return

        snapshot = await cls._snapshot(website_id_int)

        stale: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(snapshot)
            except Exception:
                stale.append(ws)

        if stale:
            async with cls._lock:
                ws_set = cls._connections.get(website_id_int)
                if ws_set:
                    for ws in stale:
                        ws_set.discard(ws)
                    if not ws_set:
                        cls._connections.pop(website_id_int, None)

    @classmethod
    async def broadcast_all(cls) -> None:
        async with cls._lock:
            website_ids = list(cls._connections.keys())

        # Broadcast per website so snapshots include website_id.
        for website_id in website_ids:
            try:
                await cls.broadcast(website_id)
            except Exception as e:
                logger.warning("presence_broadcast_failed", website_id=website_id, error=str(e))
