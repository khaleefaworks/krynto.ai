import asyncio

from app.services.agent_service import AgentService
from app.services.chat_service import ChatService


class DummyWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict):
        self.sent.append(payload)


class FailingWebSocket:
    async def send_json(self, payload: dict):
        raise RuntimeError("send failed")


def test_chatservice_deliver_bus_event_sends_to_registered_visitor_socket():
    ws = DummyWebSocket()
    ChatService.active_visitors = {123: ws}

    event = {
        "schema_version": 1,
        "event_type": "visitor_direct",
        "conversation_id": 123,
        "payload": {"type": "agent_message", "conversation_id": 123, "message": "hi"},
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert ws.sent == [event["payload"]]


def test_chatservice_deliver_bus_event_tolerates_missing_schema_version():
    ws = DummyWebSocket()
    ChatService.active_visitors = {123: ws}

    event = {
        "event_type": "visitor_direct",
        "conversation_id": 123,
        "payload": {"type": "agent_message", "conversation_id": 123, "message": "hi"},
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert ws.sent == [event["payload"]]


def test_chatservice_deliver_bus_event_ignores_wrong_event_type():
    ws = DummyWebSocket()
    ChatService.active_visitors = {123: ws}

    event = {
        "schema_version": 1,
        "event_type": "agent_direct",
        "conversation_id": 123,
        "payload": {"type": "agent_message", "conversation_id": 123, "message": "hi"},
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert ws.sent == []


def test_chatservice_deliver_bus_event_ignores_non_dict_payload():
    ws = DummyWebSocket()
    ChatService.active_visitors = {123: ws}

    event = {
        "schema_version": 1,
        "event_type": "visitor_direct",
        "conversation_id": 123,
        "payload": "not-a-dict",
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert ws.sent == []


def test_chatservice_deliver_bus_event_ignores_invalid_conversation_id():
    ws = DummyWebSocket()
    ChatService.active_visitors = {123: ws}

    event = {
        "schema_version": 1,
        "event_type": "visitor_direct",
        "conversation_id": "not-an-int",
        "payload": {"type": "agent_message", "conversation_id": 123, "message": "hi"},
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert ws.sent == []


def test_chatservice_deliver_bus_event_drops_stale_socket_on_send_failure():
    ChatService.active_visitors = {123: FailingWebSocket()}

    event = {
        "schema_version": 1,
        "event_type": "visitor_direct",
        "conversation_id": 123,
        "payload": {"type": "agent_message", "conversation_id": 123, "message": "hi"},
    }

    asyncio.run(ChatService.deliver_bus_event(event))
    assert 123 not in ChatService.active_visitors


def test_agentservice_deliver_bus_event_direct_sends_only_to_target_agent():
    ws_target = DummyWebSocket()
    ws_other = DummyWebSocket()
    AgentService.active_agents = {
        "ws-target": {"agent_id": 10, "website_id": 0, "websocket": ws_target},
        "ws-other": {"agent_id": 11, "website_id": 0, "websocket": ws_other},
    }

    event = {
        "schema_version": 1,
        "event_type": "agent_direct",
        "agent_id": 10,
        "payload": {"type": "assignment", "conversation_id": 55},
    }

    asyncio.run(AgentService.deliver_bus_event(event))
    assert ws_target.sent == [event["payload"]]
    assert ws_other.sent == []
