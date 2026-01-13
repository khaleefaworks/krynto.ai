from app.services.agent_service import AgentService
import asyncio


class DummyWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict):
        self.sent.append(payload)


def test_broadcast_website_event_reaches_global_socket_even_when_include_global_false():
    # Arrange
    global_ws = DummyWebSocket()
    website_ws = DummyWebSocket()

    AgentService.active_agents = {
        "ws-global": {"agent_id": 1, "website_id": 0, "websocket": global_ws},
        "ws-website": {"agent_id": 2, "website_id": 5, "websocket": website_ws},
    }

    service = AgentService(db=None)  # type: ignore[arg-type]

    # Act
    payload = {"type": "visitor_message", "conversation_id": 123, "website_id": 5}
    sent_count = asyncio.run(
        service.broadcast_to_active_agents(website_id=5, message_data=payload, include_global=False)
    )

    # Assert
    assert sent_count == 2
    assert global_ws.sent == [payload]
    assert website_ws.sent == [payload]


def test_broadcast_without_website_id_and_without_include_global_does_not_reach_global_socket():
    # Arrange
    global_ws = DummyWebSocket()
    AgentService.active_agents = {
        "ws-global": {"agent_id": 1, "website_id": 0, "websocket": global_ws},
    }

    service = AgentService(db=None)  # type: ignore[arg-type]

    # Act
    payload = {"type": "noop"}
    sent_count = asyncio.run(
        service.broadcast_to_active_agents(website_id=None, message_data=payload, include_global=False)
    )

    # Assert
    assert sent_count == 0
    assert global_ws.sent == []


def test_deliver_bus_event_sends_to_global_socket_for_website_scoped_broadcast():
    # Arrange
    global_ws = DummyWebSocket()
    AgentService.active_agents = {
        "ws-global": {"agent_id": 1, "website_id": 0, "websocket": global_ws},
    }

    event = {
        "schema_version": 1,
        "event_type": "agent_broadcast",
        "website_id": 7,
        "include_global": False,
        "payload": {"type": "conversation_unread", "conversation_id": 55, "website_id": 7},
    }

    # Act
    asyncio.run(AgentService.deliver_bus_event(event))

    # Assert
    assert global_ws.sent == [event["payload"]]
