import json

import pytest


@pytest.fixture()
def client_and_seeded_db():
    # Import inside the fixture so conftest's env defaults apply first.
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import init_db, SessionLocal
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.website import Website
    from app.models.user import User, UserRole
    from app.models.automation import Automation
    from app.models.agent_website_assignment import AgentWebsiteAssignment

    init_db()

    db = SessionLocal()
    try:
        # Keep fixture deterministic even with shared in-memory engine.
        db.query(Automation).delete()
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
                    password_hash="x",
                    role=UserRole.AGENT,
                    is_active=True,
                    is_available=True,
                )
            )

            # Ensure presence is deterministic.
            try:
                u = db.query(User).filter_by(id=1).first()
                if u is not None and hasattr(u, "last_heartbeat_at"):
                    setattr(u, "last_heartbeat_at", None)
            except Exception:
                pass

            db.commit()

        # Ensure agent 1 is assigned to website 1 (required for website-scoped delivery).
        existing_assignment = (
            db.query(AgentWebsiteAssignment)
            .filter(AgentWebsiteAssignment.agent_id == 1, AgentWebsiteAssignment.website_id == 1)
            .first()
        )
        if not existing_assignment:
            db.add(AgentWebsiteAssignment(agent_id=1, website_id=1))
            db.commit()

        # Admin user required for POST/PUT/DELETE /automations.
        if not db.query(User).filter_by(id=2).first():
            db.add(
                User(
                    id=2,
                    name="Admin",
                    email="admin@test.local",
                    password_hash="x",
                    role=UserRole.SYSTEM_MANAGER,
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


def _recv_until(ws, *, want_type: str, max_msgs: int = 20):
    last = None
    for _ in range(max_msgs):
        last = ws.receive_json()
        if isinstance(last, dict) and last.get("type") == want_type:
            return last
    raise AssertionError(f"Did not receive type={want_type}. Last={last}")


def _seed_resolve_automations(
    *,
    website_id: int,
    enable_bot_closing: bool,
    enable_system_resolved: bool,
):
    from app.core.database import SessionLocal
    from app.models.automation import Automation

    db = SessionLocal()
    try:
        # Ensure deterministic: remove any existing resolve automations.
        db.query(Automation).filter(
            Automation.website_id == website_id,
            Automation.trigger == "conversation_resolved",
        ).delete(synchronize_session=False)
        db.commit()

        if enable_bot_closing:
            db.add(
                Automation(
                    website_id=website_id,
                    name="Closing message",
                    trigger="conversation_resolved",
                    enabled=True,
                    conditions={},
                    actions=[
                        {
                            "type": "send_bot_message",
                            "message": "Thanks! This conversation is now closed.",
                            "event_type": "bot_closing",
                        }
                    ],
                )
            )

        if enable_system_resolved:
            db.add(
                Automation(
                    website_id=website_id,
                    name="Resolved event",
                    trigger="conversation_resolved",
                    enabled=True,
                    conditions={},
                    actions=[
                        {
                            "type": "emit_system_event",
                            "content": "This conversation has been resolved.",
                            "event_type": "conversation_resolved",
                        }
                    ],
                )
            )

        # Keep reopen disabled unless a test explicitly needs it.
        db.commit()
    finally:
        db.close()


@pytest.mark.parametrize(
    "enable_bot,enable_system,expect_bot",
    [
        (True, True, True),
        (False, True, False),
        (True, False, True),
        (False, False, False),
    ],
)
def test_resolve_emits_only_configured_actions(
    client_and_seeded_db,
    monkeypatch,
    enable_bot,
    enable_system,
    expect_bot,
):
    """Proves resolve behavior is entirely driven by enabled automations.

    This catches the common confusion:
    - Old conversations can contain events from older configs.
    - New resolves only emit what is enabled at the time of resolve.
    """

    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module

    # Avoid 60s background sleeper tasks in tests.
    async def _no_waiting_message(*, conversation_id: int, website_id: int, delay_seconds: int | None = None) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db
    token = create_access_token({"user_id": 1})

    _seed_resolve_automations(
        website_id=1,
        enable_bot_closing=bool(enable_bot),
        enable_system_resolved=bool(enable_system),
    )

    # Keep an agent connected so the website is "online".
    with client.websocket_connect(f"/ws/agent/1?token={token}") as agent_ws:
        _recv_until(agent_ws, want_type="connected")

        session_id = f"sess-resolve-{enable_bot}-{enable_system}"

        # Create conversation via first visitor message.
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as visitor_ws:
            _recv_until(visitor_ws, want_type="history")
            visitor_ws.send_text(json.dumps({"message": "hello"}))

            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            conversation_id = int(visitor_msg["conversation_id"])

        # Resolve out-of-band.
        resp = client.post(
            f"/chats/{conversation_id}/close",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

        # Reconnect visitor: use the explicit conversation route to view
        # resolved history (the generic route only shows OPEN conversations).
        with client.websocket_connect(f"/ws/chat/1/{session_id}/{conversation_id}") as visitor_ws2:
            history = _recv_until(visitor_ws2, want_type="history")
            msgs = history.get("messages") or []
            event_types = {str((m or {}).get("event_type") or "") for m in msgs}

            assert ("bot_closing" in event_types) is bool(expect_bot)
            # conversation_resolved is always emitted as a canonical lifecycle
            # event (ensure_system_event=True), regardless of automation config.
            assert "conversation_resolved" in event_types


def test_config_mismatch_is_explained_by_history_not_current_settings(client_and_seeded_db, monkeypatch):
    """Demonstrates why a conversation can show bot_closing even if the setting is later deleted.

    Steps:
    - Create conversation A with bot_closing + resolved event enabled.
    - Resolve conversation A (history now contains both event types).
    - Delete bot_closing automation.
    - Create + resolve conversation B (should NOT contain bot_closing).

    This mirrors your real testing loop (enable/disable/delete) and makes it clear
    that old conversations keep old messages.
    """

    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module
    from app.core.database import SessionLocal
    from app.models.automation import Automation

    async def _no_waiting_message(*, conversation_id: int, website_id: int, delay_seconds: int | None = None) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db
    token = create_access_token({"user_id": 1})

    # A: enable both
    _seed_resolve_automations(website_id=1, enable_bot_closing=True, enable_system_resolved=True)

    with client.websocket_connect(f"/ws/agent/1?token={token}") as agent_ws:
        _recv_until(agent_ws, want_type="connected")

        session_a = "sess-mismatch-a"
        with client.websocket_connect(f"/ws/chat/1/{session_a}") as vws_a:
            _recv_until(vws_a, want_type="history")
            vws_a.send_text(json.dumps({"message": "hello A"}))
            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            conv_a = int(visitor_msg["conversation_id"])

        resp = client.post(f"/chats/{conv_a}/close", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200

        # Delete bot_closing automation only
        db = SessionLocal()
        try:
            db.query(Automation).filter(
                Automation.website_id == 1,
                Automation.trigger == "conversation_resolved",
                Automation.name == "Closing message",
            ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

        # B: create + resolve with only system enabled
        session_b = "sess-mismatch-b"
        with client.websocket_connect(f"/ws/chat/1/{session_b}") as vws_b:
            _recv_until(vws_b, want_type="history")
            vws_b.send_text(json.dumps({"message": "hello B"}))
            visitor_msg_b = _recv_until(agent_ws, want_type="visitor_message")
            conv_b = int(visitor_msg_b["conversation_id"])

        resp2 = client.post(f"/chats/{conv_b}/close", headers={"Authorization": f"Bearer {token}"})
        assert resp2.status_code == 200

        # Verify A history still has bot_closing, B does not.
        # Use explicit conversation routes since generic route only shows OPEN conversations.
        with client.websocket_connect(f"/ws/chat/1/{session_a}/{conv_a}") as vws_a2:
            history_a = _recv_until(vws_a2, want_type="history")
            event_types_a = {str((m or {}).get("event_type") or "") for m in (history_a.get("messages") or [])}
            assert "bot_closing" in event_types_a
            assert "conversation_resolved" in event_types_a

        with client.websocket_connect(f"/ws/chat/1/{session_b}/{conv_b}") as vws_b2:
            history_b = _recv_until(vws_b2, want_type="history")
            event_types_b = {str((m or {}).get("event_type") or "") for m in (history_b.get("messages") or [])}
            assert "bot_closing" not in event_types_b
            assert "conversation_resolved" in event_types_b


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _api_list_automations(client, *, website_id: int, token: str):
    resp = client.get(f"/automations?website_id={website_id}", headers=_auth_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    return data


def _api_create_automation(client, *, token: str, payload: dict) -> dict:
    resp = client.post("/automations", json=payload, headers=_auth_headers(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert isinstance(data, dict)
    return data


def _api_update_automation(client, *, token: str, automation_id: int, payload: dict) -> dict:
    resp = client.put(f"/automations/{automation_id}", json=payload, headers=_auth_headers(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, dict)
    return data


def _api_delete_automation(client, *, token: str, automation_id: int) -> None:
    resp = client.delete(f"/automations/{automation_id}", headers=_auth_headers(token))
    assert resp.status_code == 204, resp.text


def test_automations_rest_api_matches_dashboard_behavior(client_and_seeded_db, monkeypatch):
    """End-to-end scenario using REST API CRUD, mirroring the dashboard.

    Proves:
    - Create automations via POST /automations (admin)
    - Resolve emits both actions
    - Disable/delete affects only future resolves, not existing conversation history
    """

    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module

    async def _no_waiting_message(*, conversation_id: int, website_id: int, delay_seconds: int | None = None) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db

    agent_token = create_access_token({"user_id": 1})
    admin_token = create_access_token({"user_id": 2})

    # Start clean (in case other tests inserted rows in a shared in-memory engine).
    existing = _api_list_automations(client, website_id=1, token=agent_token)
    for row in existing:
        _api_delete_automation(client, token=admin_token, automation_id=int(row["id"]))

    # 1) Create both resolve automations via REST.
    closing = _api_create_automation(
        client,
        token=admin_token,
        payload={
            "website_id": 1,
            "name": "Closing message",
            "trigger": "conversation_resolved",
            "enabled": True,
            "conditions": {},
            "actions": [
                {
                    "type": "send_bot_message",
                    "message": "Thanks! This conversation is now closed.",
                    "event_type": "bot_closing",
                }
            ],
        },
    )
    resolved_evt = _api_create_automation(
        client,
        token=admin_token,
        payload={
            "website_id": 1,
            "name": "Resolved event",
            "trigger": "conversation_resolved",
            "enabled": True,
            "conditions": {},
            "actions": [
                {
                    "type": "emit_system_event",
                    "content": "This conversation has been resolved.",
                    "event_type": "conversation_resolved",
                }
            ],
        },
    )

    assert int(closing.get("id")) > 0
    assert int(resolved_evt.get("id")) > 0

    # Keep an agent connected so the website is "online".
    with client.websocket_connect(f"/ws/agent/1?token={agent_token}") as agent_ws:
        _recv_until(agent_ws, want_type="connected")

        # A) Conversation A should get both bot_closing + conversation_resolved.
        session_a = "sess-rest-a"
        with client.websocket_connect(f"/ws/chat/1/{session_a}") as vws_a:
            _recv_until(vws_a, want_type="history")
            vws_a.send_text(json.dumps({"message": "hello A"}))
            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            conv_a = int(visitor_msg["conversation_id"])

        resp = client.post(f"/chats/{conv_a}/close", headers=_auth_headers(agent_token))
        assert resp.status_code == 200

        with client.websocket_connect(f"/ws/chat/1/{session_a}/{conv_a}") as vws_a2:
            history_a = _recv_until(vws_a2, want_type="history")
            event_types_a = {str((m or {}).get("event_type") or "") for m in (history_a.get("messages") or [])}
            assert "bot_closing" in event_types_a
            assert "conversation_resolved" in event_types_a

        # 2) Disable bot_closing via REST update; should only affect future resolves.
        _api_update_automation(client, token=admin_token, automation_id=int(closing["id"]), payload={"enabled": False})

        session_b = "sess-rest-b"
        with client.websocket_connect(f"/ws/chat/1/{session_b}") as vws_b:
            _recv_until(vws_b, want_type="history")
            vws_b.send_text(json.dumps({"message": "hello B"}))
            visitor_msg_b = _recv_until(agent_ws, want_type="visitor_message")
            conv_b = int(visitor_msg_b["conversation_id"])

        resp2 = client.post(f"/chats/{conv_b}/close", headers=_auth_headers(agent_token))
        assert resp2.status_code == 200

        with client.websocket_connect(f"/ws/chat/1/{session_b}/{conv_b}") as vws_b2:
            history_b = _recv_until(vws_b2, want_type="history")
            event_types_b = {str((m or {}).get("event_type") or "") for m in (history_b.get("messages") or [])}
            assert "bot_closing" not in event_types_b
            assert "conversation_resolved" in event_types_b

        # A remains unchanged.
        with client.websocket_connect(f"/ws/chat/1/{session_a}/{conv_a}") as vws_a3:
            history_a3 = _recv_until(vws_a3, want_type="history")
            event_types_a3 = {str((m or {}).get("event_type") or "") for m in (history_a3.get("messages") or [])}
            assert "bot_closing" in event_types_a3
            assert "conversation_resolved" in event_types_a3

        # 3) Delete the resolved event automation; future resolves should now emit nothing.
        _api_delete_automation(client, token=admin_token, automation_id=int(resolved_evt["id"]))

        session_c = "sess-rest-c"
        with client.websocket_connect(f"/ws/chat/1/{session_c}") as vws_c:
            _recv_until(vws_c, want_type="history")
            vws_c.send_text(json.dumps({"message": "hello C"}))
            visitor_msg_c = _recv_until(agent_ws, want_type="visitor_message")
            conv_c = int(visitor_msg_c["conversation_id"])

        resp3 = client.post(f"/chats/{conv_c}/close", headers=_auth_headers(agent_token))
        assert resp3.status_code == 200

        with client.websocket_connect(f"/ws/chat/1/{session_c}/{conv_c}") as vws_c2:
            history_c = _recv_until(vws_c2, want_type="history")
            event_types_c = {str((m or {}).get("event_type") or "") for m in (history_c.get("messages") or [])}
            assert "bot_closing" not in event_types_c
            # conversation_resolved is always emitted as a canonical lifecycle event.
            assert "conversation_resolved" in event_types_c


def test_repeat_always_allows_multiple_resolve_cycles_via_rest_api(client_and_seeded_db, monkeypatch):
    """When repeat=always, resolved automations fire on every new conversation resolve.

    After the session/conversation refactor, conversations are never reopened;
    a new visitor message after resolution creates a fresh OPEN conversation.
    This test verifies that each fresh conversation's resolve cycle independently
    fires the configured automations.
    """

    from app.core.security import create_access_token
    from app.services import conversation_orchestrator as orchestrator_module

    async def _no_waiting_message(*, conversation_id: int, website_id: int, delay_seconds: int | None = None) -> None:
        return None

    monkeypatch.setattr(
        orchestrator_module,
        "_send_delayed_waiting_message_if_unassigned",
        _no_waiting_message,
    )

    client = client_and_seeded_db
    agent_token = create_access_token({"user_id": 1})
    admin_token = create_access_token({"user_id": 2})

    # Clean slate
    existing = _api_list_automations(client, website_id=1, token=agent_token)
    for row in existing:
        _api_delete_automation(client, token=admin_token, automation_id=int(row["id"]))

    _api_create_automation(
        client,
        token=admin_token,
        payload={
            "website_id": 1,
            "name": "Resolved event",
            "trigger": "conversation_resolved",
            "enabled": True,
            "conditions": {"repeat": "always"},
            "actions": [
                {
                    "type": "emit_system_event",
                    "content": "This conversation has been resolved.",
                    "event_type": "conversation_resolved",
                }
            ],
        },
    )

    _api_create_automation(
        client,
        token=admin_token,
        payload={
            "website_id": 1,
            "name": "Closing message",
            "trigger": "conversation_resolved",
            "enabled": True,
            "conditions": {"repeat": "always"},
            "actions": [
                {
                    "type": "send_bot_message",
                    "message": "Thanks! This conversation is now closed.",
                    "event_type": "bot_closing",
                }
            ],
        },
    )

    with client.websocket_connect(f"/ws/agent/1?token={agent_token}") as agent_ws:
        _recv_until(agent_ws, want_type="connected")

        session_id = "sess-repeat-always"

        # Cycle 1: Create conversation and resolve.
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as vws:
            _recv_until(vws, want_type="history")
            vws.send_text(json.dumps({"message": "hello"}))
            visitor_msg = _recv_until(agent_ws, want_type="visitor_message")
            conv_1 = int(visitor_msg["conversation_id"])

        resp1 = client.post(f"/chats/{conv_1}/close", headers=_auth_headers(agent_token))
        assert resp1.status_code == 200

        # Check conv_1 history has both events.
        with client.websocket_connect(f"/ws/chat/1/{session_id}/{conv_1}") as vws2:
            history = _recv_until(vws2, want_type="history")
            msgs = history.get("messages") or []
            resolved_count = sum(1 for m in msgs if (m or {}).get("event_type") == "conversation_resolved")
            closing_count = sum(1 for m in msgs if (m or {}).get("event_type") == "bot_closing")
            assert resolved_count >= 1
            assert closing_count >= 1

        # Cycle 2: Visitor sends new message → gets a new OPEN conversation.
        with client.websocket_connect(f"/ws/chat/1/{session_id}") as vws3:
            _recv_until(vws3, want_type="history")
            vws3.send_text(json.dumps({"message": "back again"}))
            visitor_msg_2 = _recv_until(agent_ws, want_type="visitor_message")
            conv_2 = int(visitor_msg_2["conversation_id"])
            assert conv_2 != conv_1  # Must be a new conversation

        # Resolve conversation 2.
        resp2 = client.post(f"/chats/{conv_2}/close", headers=_auth_headers(agent_token))
        assert resp2.status_code == 200

        # Check conv_2 also got its own resolve events.
        with client.websocket_connect(f"/ws/chat/1/{session_id}/{conv_2}") as vws4:
            history_2 = _recv_until(vws4, want_type="history")
            msgs_2 = history_2.get("messages") or []
            resolved_count_2 = sum(1 for m in msgs_2 if (m or {}).get("event_type") == "conversation_resolved")
            closing_count_2 = sum(1 for m in msgs_2 if (m or {}).get("event_type") == "bot_closing")
            assert resolved_count_2 >= 1
            assert closing_count_2 >= 1
