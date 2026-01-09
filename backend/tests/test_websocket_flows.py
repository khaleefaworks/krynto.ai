import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client_and_seeded_db():
    # Import inside the fixture so conftest's env defaults apply first.
    from app.main import app
    from app.core.database import init_db, SessionLocal
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.website import Website
    from app.models.user import User, UserRole

    init_db()

    db = SessionLocal()
    try:
        # Make the fixture deterministic even when the in-memory SQLite engine
        # is shared across tests (StaticPool).
        db.query(Message).delete()
        db.query(Conversation).delete()
        db.commit()

        # Minimal website required for /ws/chat validation.
        if not db.query(Website).filter_by(id=1).first():
            db.add(Website(id=1, name="Test Site", domain="test.local"))

        # Minimal agent user required for /ws/agent JWT auth.
        if not db.query(User).filter_by(id=1).first():
            db.add(
                User(
                    id=1,
                    name="Agent",
                    email="agent@test.local",
                    password_hash="x",  # not used by WS auth
                    role=UserRole.AGENT,
                    is_active=True,
                    is_available=True,
                )
            )

        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        yield client


@pytest.fixture(autouse=True)
def _reset_in_memory_ws_registries():
    # Ensure class-level WS registries never leak between tests.
    from app.services.agent_service import AgentService
    from app.services.chat_service import ChatService

    AgentService.active_agents.clear()
    AgentService.last_heartbeat.clear()
    ChatService.active_visitors.clear()
    yield
    AgentService.active_agents.clear()
    AgentService.last_heartbeat.clear()
    ChatService.active_visitors.clear()


def _recv_until(ws, *, want_type: str, max_msgs: int = 10):
    """Receive up to max_msgs JSON frames until one matches want_type."""
    last = None
    for _ in range(max_msgs):
        last = ws.receive_json()
        if isinstance(last, dict) and last.get("type") == want_type:
            return last
    raise AssertionError(f"Did not receive type={want_type}. Last={last}")


def test_websocket_agent_visitor_basic_flow(client_and_seeded_db, monkeypatch):
    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module

    # Avoid 60s background sleeper tasks in tests.
    async def _no_waiting_message(*, conversation_id: int, website_id: int) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db

    token = create_access_token({"user_id": 1})

    # 1) Agent connects first (website is considered online).
    with client.websocket_connect(f"/ws/agent/1?token={token}") as agent_ws:
        connected = _recv_until(agent_ws, want_type="connected")
        assert connected["agent_id"] == 1
        assert connected["website_id"] == 1

        # 2) Visitor connects and gets initial empty history.
        session_id = "sess-1"
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as visitor_ws:
            history = _recv_until(visitor_ws, want_type="history")
            assert "messages" in history
            assert isinstance(history["messages"], list)

            # 3) Visitor sends a message; agent should receive visitor_message with message_obj.
            visitor_ws.send_text(json.dumps({"message": "hello"}))

            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            assert isinstance(visitor_msg.get("conversation_id"), int)
            assert visitor_msg.get("message") == "hello"
            assert isinstance(visitor_msg.get("message_obj"), dict)
            assert visitor_msg["message_obj"].get("content") == "hello"

            conversation_id = int(visitor_msg["conversation_id"])

            # 4) Agent joins the chat; should receive joined with both history and messages.
            agent_ws.send_text(
                json.dumps({"type": "join_chat", "conversation_id": conversation_id})
            )
            joined = _recv_until(agent_ws, want_type="joined")
            assert joined["conversation_id"] == conversation_id
            assert isinstance(joined.get("history"), list)
            assert isinstance(joined.get("messages"), list)
            assert joined["history"] == joined["messages"]
            assert any(m.get("content") == "hello" for m in joined["history"])

            # Visitor should see agent_joined notification.
            agent_joined = _recv_until(visitor_ws, want_type="agent_joined")
            assert "agent_name" in agent_joined

            # 5) Agent sends a message; should get ack + message_sent (with message_obj),
            # and visitor should receive the agent message.
            agent_ws.send_text(
                json.dumps(
                    {
                        "type": "message",
                        "conversation_id": conversation_id,
                        "content": "hi there",
                        "message_id": "m1",
                    }
                )
            )

            ack = _recv_until(agent_ws, want_type="ack")
            assert ack.get("message_id") == "m1"

            sent = _recv_until(agent_ws, want_type="message_sent")
            assert sent.get("conversation_id") == conversation_id
            assert sent.get("content") == "hi there"
            assert sent.get("success") is True
            assert isinstance(sent.get("message_obj"), dict)
            assert sent["message_obj"].get("content") == "hi there"

            agent_to_visitor = _recv_until(visitor_ws, want_type="agent")
            assert agent_to_visitor.get("message") == "hi there"


def test_websocket_visitor_reconnect_gets_history(client_and_seeded_db, monkeypatch):
    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module

    # Avoid 60s background sleeper tasks in tests.
    async def _no_waiting_message(*, conversation_id: int, website_id: int) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db
    token = create_access_token({"user_id": 1})

    session_id = "sess-reconnect"

    # Keep an agent connected so the website is "online".
    with client.websocket_connect(f"/ws/agent/1?token={token}") as agent_ws:
        _recv_until(agent_ws, want_type="connected")

        # First visitor connection: send a message to create the conversation.
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as visitor_ws:
            _recv_until(visitor_ws, want_type="history")
            visitor_ws.send_text(json.dumps({"message": "first"}))

            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            conversation_id = int(visitor_msg["conversation_id"])
            assert visitor_msg.get("message") == "first"
            assert visitor_msg.get("message_obj", {}).get("content") == "first"

        # Reconnect: should receive history for the existing conversation.
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as visitor_ws_2:
            history2 = _recv_until(visitor_ws_2, want_type="history")
            assert history2.get("conversation_id") == conversation_id
            msgs = history2.get("messages")
            assert isinstance(msgs, list)
            assert any(m.get("content") == "first" for m in msgs)
