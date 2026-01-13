import pytest

from app.services.agent_service import AgentService


@pytest.fixture(autouse=True)
def _reset_agent_service_state():
    # Ensure class-level state never leaks between tests.
    old_active_agents = AgentService.active_agents
    old_last_heartbeat = AgentService.last_heartbeat
    try:
        AgentService.active_agents = {}
        AgentService.last_heartbeat = {}
        yield
    finally:
        AgentService.active_agents = old_active_agents
        AgentService.last_heartbeat = old_last_heartbeat


def test_connected_agent_ids_returns_agent_ids_from_active_agents():
    AgentService.active_agents = {
        "ws-1": {"agent_id": 10, "website_id": 1, "websocket": object()},
        "ws-2": {"agent_id": "11", "website_id": 2, "websocket": object()},
        "ws-3": {"website_id": 2, "websocket": object()},  # missing agent_id
    }

    assert AgentService.connected_agent_ids() == {10, 11}


def test_recently_active_agent_ids_filters_by_ttl(monkeypatch):
    # Freeze time and configure a deterministic TTL window.
    monkeypatch.setattr("app.services.agent_service.time.time", lambda: 1000.0)
    AgentService.heartbeat_ttl_seconds = 75

    AgentService.last_heartbeat = {
        1: 1000.0,  # now
        2: 926.0,  # 74s ago => within TTL
        3: 924.0,  # 76s ago => outside TTL
    }

    assert AgentService.recently_active_agent_ids() == {1, 2}
