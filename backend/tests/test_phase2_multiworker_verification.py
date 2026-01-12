import asyncio

import pytest

from app.infra import realtime_bus
from app.services.agent_service import AgentService


class DummyWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict):
        self.sent.append(payload)


@pytest.fixture(autouse=True)
def _reset_agent_connections():
    old_active_agents = AgentService.active_agents
    try:
        AgentService.active_agents = {}
        yield
    finally:
        AgentService.active_agents = old_active_agents


@pytest.fixture()
def _force_realtime_bus_disabled():
    # realtime_bus.enabled is a @property; set its internal flag.
    old = getattr(realtime_bus, "_enabled", None)
    try:
        setattr(realtime_bus, "_enabled", False)
        yield
    finally:
        try:
            setattr(realtime_bus, "_enabled", old)
        except Exception:
            pass


def test_agentservice_send_to_agent_local_delivery_sends_to_matching_agent(_force_realtime_bus_disabled):
    ws_target_1 = DummyWebSocket()
    ws_target_2 = DummyWebSocket()
    ws_other = DummyWebSocket()

    AgentService.active_agents = {
        "ws-a": {"agent_id": 10, "website_id": 0, "websocket": ws_target_1},
        "ws-b": {"agent_id": 10, "website_id": 2, "websocket": ws_target_2},
        "ws-c": {"agent_id": 11, "website_id": 0, "websocket": ws_other},
    }

    service = AgentService(db=None)  # type: ignore[arg-type]

    payload = {"type": "assignment", "conversation_id": 55}
    asyncio.run(service.send_to_agent(10, payload))

    assert ws_target_1.sent == [payload]
    assert ws_target_2.sent == [payload]
    assert ws_other.sent == []


def test_agentservice_send_to_agent_local_delivery_tolerates_string_agent_id_in_registry(_force_realtime_bus_disabled):
    ws_target = DummyWebSocket()
    AgentService.active_agents = {
        "ws-a": {"agent_id": "10", "website_id": 0, "websocket": ws_target},
    }

    service = AgentService(db=None)  # type: ignore[arg-type]
    payload = {"type": "assignment", "conversation_id": 55}
    asyncio.run(service.send_to_agent(10, payload))

    assert ws_target.sent == [payload]
