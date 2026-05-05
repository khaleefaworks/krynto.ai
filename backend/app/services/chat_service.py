from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from app.core.logging import get_logger
from app.infra import realtime_bus, BusEvent

logger = get_logger(__name__)


class ChatService:
    """
    Simplified service for managing visitor WebSocket connections.
    Only handles visitor socket registration and message delivery.
    All business logic is in ConversationOrchestrator.
    """
    
    # Track active visitor WebSocket connections
    # Key: conversation_id, Value: WebSocket object
    active_visitors: Dict[int, object] = {}

    # Session-level presence for Customers -> Visitors.
    # Key: (website_id, session_id)
    # Value: {"sockets": set[object], "connected_at": datetime, "last_disconnected_at": datetime | None}
    _session_presence: Dict[Tuple[int, str], dict] = {}

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def register_session(cls, website_id: int, session_id: str, websocket: object) -> None:
        key = (int(website_id), str(session_id))
        now = cls._utcnow()

        entry = cls._session_presence.get(key)
        if not entry:
            cls._session_presence[key] = {
                "sockets": {websocket},
                "connected_at": now,
                "last_disconnected_at": None,
            }
            return

        sockets: Set[object] = entry.get("sockets") or set()
        sockets.add(websocket)
        entry["sockets"] = sockets
        # If the visitor reconnects, treat them as online again.
        entry["last_disconnected_at"] = None

    @classmethod
    def unregister_session_socket(cls, websocket: object) -> None:
        now = cls._utcnow()

        for key, entry in list(cls._session_presence.items()):
            sockets: Set[object] = entry.get("sockets") or set()
            if websocket not in sockets:
                continue
            try:
                sockets.discard(websocket)
            except Exception:
                sockets = {ws for ws in sockets if ws is not websocket}
            if sockets:
                entry["sockets"] = sockets
                continue

            # No more sockets for this session.
            entry["sockets"] = set()
            entry["last_disconnected_at"] = now

    @classmethod
    def session_presence_snapshot(
        cls,
        *,
        website_id: int | None = None,
        recently_left_within_seconds: int = 600,
    ) -> List[dict]:
        """Return session presence records for currently connected and recently disconnected visitors."""
        now = cls._utcnow()
        recently_left_within_seconds = max(0, int(recently_left_within_seconds))

        out: List[dict] = []
        for (wid, sid), entry in list(cls._session_presence.items()):
            if website_id is not None and int(wid) != int(website_id):
                continue

            sockets: Set[object] = entry.get("sockets") or set()
            connected_at: datetime | None = entry.get("connected_at")
            last_disconnected_at: datetime | None = entry.get("last_disconnected_at")

            is_online = bool(sockets)
            if not is_online:
                if not last_disconnected_at:
                    continue
                try:
                    age = (now - last_disconnected_at).total_seconds()
                except Exception:
                    age = None
                if age is None or age > recently_left_within_seconds:
                    # Purge stale offline entries.
                    try:
                        del cls._session_presence[(wid, sid)]
                    except KeyError:
                        pass
                    continue

            out.append(
                {
                    "website_id": int(wid),
                    "session_id": str(sid),
                    "is_online": is_online,
                    "connected_at": connected_at,
                    "last_disconnected_at": last_disconnected_at,
                }
            )

        # Sort: online first (newest connections first), then recently disconnected (most recent first)
        def _sort_key(r: dict) -> tuple:
            online = 1 if r.get("is_online") else 0
            ts = r.get("connected_at") if r.get("is_online") else r.get("last_disconnected_at")
            # None-safe
            return (-online, -(ts.timestamp() if isinstance(ts, datetime) else 0.0))

        out.sort(key=_sort_key)
        return out

    @classmethod
    def is_session_online(cls, *, website_id: int, session_id: str) -> bool:
        key = (int(website_id), str(session_id))
        entry = cls._session_presence.get(key)
        if not entry:
            return False
        sockets: Set[object] = entry.get("sockets") or set()
        return bool(sockets)

    @classmethod
    def link_session_to_conversation(cls, *, website_id: int, session_id: str, conversation_id: int) -> None:
        """Best-effort: register any currently-connected session socket(s) for a new conversation.

        This enables agent-initiated chats to deliver messages immediately, even if the
        visitor websocket connected before the conversation existed.

        Note: we only keep websocket objects in memory; session presence stores socket ids.
        We therefore link via the active visitor socket registry when possible.
        """

        # If the visitor websocket is already mapped for this conversation, nothing to do.
        if int(conversation_id) in cls.active_visitors:
            return

        key = (int(website_id), str(session_id))
        entry = cls._session_presence.get(key)
        if not entry:
            return

        sockets: Set[object] = entry.get("sockets") or set()
        for ws in list(sockets):
            try:
                cls.register_visitor(int(conversation_id), ws)
                break
            except Exception:
                continue
    
    @staticmethod
    async def send_to_visitor(conversation_id: int, message_data: dict):
        """Send message to visitor's WebSocket if they're connected"""
        # Prefer direct delivery when the visitor socket is local.
        # This avoids occasional Redis Pub/Sub reconnect/backoff delays.
        if conversation_id in ChatService.active_visitors:
            websocket = ChatService.active_visitors[conversation_id]
            try:
                await websocket.send_json(message_data)
                logger.info("message_sent_to_visitor", conversation_id=conversation_id, message_type=message_data.get("type"))
                return
            except Exception as e:
                logger.error("failed_to_send_to_visitor", conversation_id=conversation_id, error=str(e))
                # Drop stale socket mapping so future sends don't keep failing.
                try:
                    ChatService.unregister_visitor(conversation_id)
                except Exception:
                    pass

        # If Redis is enabled, publish and let the subscriber deliver to whichever
        # worker actually holds the visitor websocket.
        if realtime_bus.enabled:
            await realtime_bus.publish(
                BusEvent(
                    event_type="visitor_direct",
                    conversation_id=int(conversation_id),
                    payload=message_data,
                )
            )
            return

        logger.warning("visitor_not_connected", conversation_id=conversation_id)

    @classmethod
    async def deliver_bus_event(cls, event: dict) -> None:
        """Deliver a Redis bus event to a locally connected visitor socket."""

        if event.get("event_type") != "visitor_direct":
            return

        payload = event.get("payload")
        if not isinstance(payload, dict):
            return

        try:
            conversation_id = int(event.get("conversation_id"))
        except Exception:
            return

        websocket = cls.active_visitors.get(conversation_id)
        if not websocket:
            return

        try:
            await websocket.send_json(payload)
        except Exception:
            try:
                cls.unregister_visitor(conversation_id)
            except Exception:
                pass
    
    @staticmethod
    def register_visitor(conversation_id: int, websocket):
        """Register a visitor's WebSocket connection"""
        ChatService.active_visitors[conversation_id] = websocket
        logger.info("visitor_registered", conversation_id=conversation_id)
    
    @staticmethod
    def unregister_visitor(conversation_id: int):
        """Remove a visitor's WebSocket connection"""
        if conversation_id in ChatService.active_visitors:
            del ChatService.active_visitors[conversation_id]
            logger.info("visitor_unregistered", conversation_id=conversation_id)

    @staticmethod
    def unregister_visitor_socket(websocket) -> None:
        """Remove any visitor mappings that point at the given websocket.

        This is a safety-net for disconnect/error paths where the handler may not
        know (or may have failed to compute) the conversation_id.
        """

        stale_conversation_ids = [
            conversation_id
            for conversation_id, ws in list(ChatService.active_visitors.items())
            if ws is websocket
        ]

        for conversation_id in stale_conversation_ids:
            try:
                del ChatService.active_visitors[conversation_id]
            except KeyError:
                continue
            logger.info("visitor_unregistered", conversation_id=conversation_id)
