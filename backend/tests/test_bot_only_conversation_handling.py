"""Bot-only conversation bug fixes:
  1. No agent push/sound for bot-only conversations (visitor_dropped/reconnected
     automations, or any other show_notification-opted-in automation node).
  2. Abandoned bot-only conversations (visitor left mid-IVR, never reached a
     leaf button) get auto-resolved, reusing the existing
     _close_bot_conversation_after_delay function.

(bot_only being included in the widget's `history`/`bot_prompt` WS payloads,
and the dashboard composer/badge, are frontend-only changes with no backend
test surface.)
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.fixture()
def db_session():
    from app.core.database import Base, engine, SessionLocal
    from app import models  # noqa: F401 — ensure metadata is complete

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)


def _make_conversation(db, *, bot_only=False, status=None):
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.website import Website

    if not db.query(Website).filter_by(id=1).first():
        db.add(Website(id=1, name="Test Site", domain="test.local"))
        db.commit()

    conv = Conversation(
        website_id=1, session_id="sess-bot-only-test", bot_only=bot_only,
        status=status or ConversationStatus.OPEN,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@pytest.mark.asyncio
async def test_notify_agents_like_message_skips_bot_only_conversation(db_session):
    from app.services.conversation_orchestrator import ConversationOrchestrator

    conv = _make_conversation(db_session, bot_only=True)
    orch = ConversationOrchestrator(db_session)
    orch.agent_service.send_to_agent = AsyncMock()
    orch.agent_service.broadcast_to_active_agents = AsyncMock()

    await orch._notify_agents_like_message(
        conversation=conv, website_id=1, title="t", body="b", event_type="visitor_dropped",
    )

    orch.agent_service.send_to_agent.assert_not_called()
    orch.agent_service.broadcast_to_active_agents.assert_not_called()


@pytest.mark.asyncio
async def test_notify_agents_like_message_still_fires_for_normal_conversation(db_session):
    from app.services.conversation_orchestrator import ConversationOrchestrator

    conv = _make_conversation(db_session, bot_only=False)
    orch = ConversationOrchestrator(db_session)
    orch.agent_service.send_to_agent = AsyncMock()
    orch.agent_service.broadcast_to_active_agents = AsyncMock()

    await orch._notify_agents_like_message(
        conversation=conv, website_id=1, title="t", body="b", event_type="visitor_dropped",
    )

    # No assigned_agent_id on this conversation -> broadcasts to the team/website.
    orch.agent_service.broadcast_to_active_agents.assert_called_once()
    orch.agent_service.send_to_agent.assert_not_called()


@pytest.mark.asyncio
async def test_visitor_left_website_schedules_close_for_abandoned_bot_only_conversation(db_session, monkeypatch):
    from app.services import conversation_orchestrator as orch_module

    conv = _make_conversation(db_session, bot_only=True)

    scheduled = []

    def fake_create_task(coro):
        scheduled.append(coro)
        coro.close()  # never actually run it — just record that scheduling happened
        return SimpleNamespace()

    monkeypatch.setattr(orch_module.asyncio, "create_task", fake_create_task)
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_run_automation_flows", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_should_record_presence_event", lambda self, **kw: True
    )

    orch = orch_module.ConversationOrchestrator(db_session)
    orch.agent_service.broadcast_to_active_agents = AsyncMock()

    await orch.visitor_left_website(conversation_id=conv.id)

    assert len(scheduled) == 1


@pytest.mark.asyncio
async def test_visitor_left_website_does_not_schedule_close_for_normal_conversation(db_session, monkeypatch):
    from app.services import conversation_orchestrator as orch_module

    conv = _make_conversation(db_session, bot_only=False)

    scheduled = []

    def fake_create_task(coro):
        scheduled.append(coro)
        coro.close()
        return SimpleNamespace()

    monkeypatch.setattr(orch_module.asyncio, "create_task", fake_create_task)
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_run_automation_flows", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_should_record_presence_event", lambda self, **kw: True
    )

    orch = orch_module.ConversationOrchestrator(db_session)
    orch.agent_service.broadcast_to_active_agents = AsyncMock()

    await orch.visitor_left_website(conversation_id=conv.id)

    assert len(scheduled) == 0


@pytest.mark.asyncio
async def test_close_bot_conversation_after_delay_reuses_close_conversation(db_session, monkeypatch):
    """Bot auto-resolve must route through the same close_conversation() path a
    human resolve uses (closed_by="bot", agent_name="Bot"), but on its own
    "bot_conversation_resolved" trigger — not the human "conversation_resolved"
    trigger (that coupled bot resolves to a site's human rating-popup-on-resolve
    automation) and not a bespoke hardcoded status flip. send_to_visitor is
    left at its default (True): the node's own "Send to visitor" toggle in the
    flow editor is the real, editable gate, not a Python-side lock.
    """
    from app.services import conversation_orchestrator as orch_module

    conv = _make_conversation(db_session, bot_only=True)

    async def fake_sleep(_secs):
        return None

    close_calls = []

    async def fake_close_conversation(
        self, *, conversation_id, closed_by="agent", agent_name=None,
        trigger="conversation_resolved", send_to_visitor=True,
    ):
        close_calls.append({
            "conversation_id": conversation_id, "closed_by": closed_by, "agent_name": agent_name,
            "trigger": trigger, "send_to_visitor": send_to_visitor,
        })
        return {"success": True, "closed_by": closed_by}

    monkeypatch.setattr(orch_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(orch_module.ConversationOrchestrator, "close_conversation", fake_close_conversation)

    await orch_module._close_bot_conversation_after_delay(
        conversation_id=conv.id, website_id=1, delay_seconds=3,
    )

    assert close_calls == [{
        "conversation_id": conv.id, "closed_by": "bot", "agent_name": "Bot",
        "trigger": "bot_conversation_resolved", "send_to_visitor": True,
    }]


@pytest.mark.asyncio
async def test_visitor_left_website_does_not_schedule_close_for_already_resolved_bot_only_conversation(db_session, monkeypatch):
    from app.models.conversation import ConversationStatus
    from app.services import conversation_orchestrator as orch_module

    conv = _make_conversation(db_session, bot_only=True, status=ConversationStatus.RESOLVED)

    scheduled = []

    def fake_create_task(coro):
        scheduled.append(coro)
        coro.close()
        return SimpleNamespace()

    monkeypatch.setattr(orch_module.asyncio, "create_task", fake_create_task)
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_run_automation_flows", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        orch_module.ConversationOrchestrator, "_should_record_presence_event", lambda self, **kw: True
    )

    orch = orch_module.ConversationOrchestrator(db_session)
    orch.agent_service.broadcast_to_active_agents = AsyncMock()

    await orch.visitor_left_website(conversation_id=conv.id)

    assert len(scheduled) == 0
