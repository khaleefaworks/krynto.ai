from typing import Dict

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
    
    @staticmethod
    async def send_to_visitor(conversation_id: int, message_data: dict):
        """Send message to visitor's WebSocket if they're connected"""
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

        if conversation_id in ChatService.active_visitors:
            websocket = ChatService.active_visitors[conversation_id]
            try:
                await websocket.send_json(message_data)
                logger.info("message_sent_to_visitor", conversation_id=conversation_id, message_type=message_data.get("type"))
            except Exception as e:
                logger.error("failed_to_send_to_visitor", conversation_id=conversation_id, error=str(e))
                # Drop stale socket mapping so future sends don't keep failing.
                try:
                    ChatService.unregister_visitor(conversation_id)
                except Exception:
                    pass
        else:
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
