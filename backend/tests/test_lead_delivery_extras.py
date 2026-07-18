"""Tests for the lead-delivery follow-on work (INT1 gap-fill):
  - per-form webhook routing (WebsiteIntegration.form_id)
  - the lead_delivered automation trigger fires only on confirmed webhook
    success (not on capture, not on failure), and is form-agnostic
  - force_resend_delivery re-pushes a delivery on demand
  - the agent-facing /conversations/{id}/leads endpoints (status, send-now,
    resend) and their has_integrations gating
"""
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture()
def routing_env():
    from app.core.database import Base, engine, SessionLocal
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.website_form import WebsiteForm
    from app.models.website_integration import WebsiteIntegration, WebsiteIntegrationType
    from app import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.flush()
        db.add(Website(id=1, organization_id=1, name="Site A", domain="a.example.com", widget_key="k1"))
        db.flush()

        conv = Conversation(website_id=1, session_id="s1", status=ConversationStatus.OPEN)
        db.add(conv)

        form_a = WebsiteForm(website_id=1, name="Form A", slug="form-a", fields=[], is_contact_card=True)
        form_b = WebsiteForm(website_id=1, name="Form B", slug="form-b", fields=[])
        db.add_all([form_a, form_b])
        db.flush()

        scoped_to_a = WebsiteIntegration(
            website_id=1, type=WebsiteIntegrationType.WEBHOOK, name="Scoped to A",
            enabled=True, form_id=form_a.id, config={"url": "https://hooks.example.com/a"},
        )
        unscoped = WebsiteIntegration(
            website_id=1, type=WebsiteIntegrationType.WEBHOOK, name="Unscoped",
            enabled=True, form_id=None, config={"url": "https://hooks.example.com/all"},
        )
        db.add_all([scoped_to_a, unscoped])
        db.commit()

        yield db, conv.id, form_a.id, form_b.id, scoped_to_a.id, unscoped.id
    finally:
        db.close()


def test_form_scoped_integration_only_fires_for_that_form(routing_env):
    db, conv_id, form_a_id, form_b_id, scoped_id, unscoped_id = routing_env
    from app.services.lead_integration_service import enqueue_lead
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    enqueue_lead(db, website_id=1, conversation_id=conv_id, form_id=form_a_id, source="live_chat_form", name="Jane")

    rows = db.query(LeadIntegrationDelivery).filter_by(conversation_id=conv_id).all()
    integration_ids = {r.integration_id for r in rows}
    assert integration_ids == {scoped_id, unscoped_id}


def test_form_scoped_integration_does_not_fire_for_other_forms(routing_env):
    db, conv_id, form_a_id, form_b_id, scoped_id, unscoped_id = routing_env
    from app.services.lead_integration_service import enqueue_lead
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    enqueue_lead(db, website_id=1, conversation_id=conv_id, form_id=form_b_id, source="live_chat_form", name="Jane")

    rows = db.query(LeadIntegrationDelivery).filter_by(conversation_id=conv_id).all()
    integration_ids = {r.integration_id for r in rows}
    assert integration_ids == {unscoped_id}


def test_no_form_id_only_reaches_unscoped_integrations(routing_env):
    """The offline gate has no associated form — only website-wide
    integrations (form_id=None) should fire for it."""
    db, conv_id, form_a_id, form_b_id, scoped_id, unscoped_id = routing_env
    from app.services.lead_integration_service import enqueue_lead
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    enqueue_lead(db, website_id=1, conversation_id=conv_id, source="offline_gate", name="Jane")

    rows = db.query(LeadIntegrationDelivery).filter_by(conversation_id=conv_id).all()
    integration_ids = {r.integration_id for r in rows}
    assert integration_ids == {unscoped_id}


@pytest.mark.asyncio
async def test_lead_delivered_trigger_fires_only_after_successful_delivery(routing_env):
    db, conv_id, form_a_id, _form_b_id, scoped_id, _unscoped_id = routing_env
    from app.services.lead_integration_service import _attempt_delivery
    from app.repos import lead_integration_deliveries as deliveries_repo
    from app.repos import website_integrations as integrations_repo

    # Isolate to just the form-scoped integration so exactly one delivery exists.
    integrations_repo.delete_integration(db, integrations_repo.get_integration_by_id(db, _unscoped_id))
    delivery = deliveries_repo.create_pending(
        db, website_id=1, integration_id=scoped_id, source="live_chat_form",
        payload={"name": "Jane"}, conversation_id=conv_id,
    )

    fake_orchestrator = AsyncMock()
    with patch("app.services.lead_integration_service._push_webhook", side_effect=Exception("boom")), \
         patch("app.services.conversation_orchestrator.ConversationOrchestrator", return_value=fake_orchestrator):
        await _attempt_delivery(delivery.id)

    fake_orchestrator._run_automation_flows.assert_not_called()

    fake_orchestrator2 = AsyncMock()
    with patch("app.services.lead_integration_service._push_webhook", return_value=None), \
         patch("app.services.conversation_orchestrator.ConversationOrchestrator", return_value=fake_orchestrator2):
        await _attempt_delivery(delivery.id)

    fake_orchestrator2._run_automation_flows.assert_awaited_once()
    _, kwargs = fake_orchestrator2._run_automation_flows.await_args
    assert kwargs["trigger"] == "lead_delivered"
    assert kwargs["conversation_id"] == conv_id


@pytest.mark.asyncio
async def test_force_resend_delivery_repushes_and_updates_status(routing_env):
    db, conv_id, form_a_id, _form_b_id, scoped_id, unscoped_id = routing_env
    from app.services.lead_integration_service import force_resend_delivery
    from app.repos import lead_integration_deliveries as deliveries_repo
    from app.models.lead_integration_delivery import LeadDeliveryStatus

    delivery = deliveries_repo.create_pending(
        db, website_id=1, integration_id=unscoped_id, source="agent_manual",
        payload={"name": "Jane"}, conversation_id=conv_id,
    )
    deliveries_repo.mark_as_failed_with_retry(db, delivery.id, attempt_count=5, error_message="timed out")

    with patch("app.services.lead_integration_service._push_webhook", return_value=None), \
         patch("app.services.lead_integration_service._fire_lead_delivered_trigger", new=AsyncMock()):
        result = await force_resend_delivery(db, delivery.id)

    assert result["status"] == LeadDeliveryStatus.SENT.value


@pytest.mark.asyncio
async def test_force_resend_delivery_raises_for_unknown_id(routing_env):
    db, *_ = routing_env
    from app.services.lead_integration_service import force_resend_delivery

    with pytest.raises(ValueError):
        await force_resend_delivery(db, 999999)


def test_has_enabled_integrations(routing_env):
    db, *_ = routing_env
    from app.repos import website_integrations as integrations_repo

    assert integrations_repo.has_enabled_integrations(db, 1) is True
    assert integrations_repo.has_enabled_integrations(db, 999) is False


@pytest.fixture()
def leads_api_env():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import Base, engine, SessionLocal
    from app.core.security import get_password_hash
    from app.models.user import User, UserRole
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.website_integration import WebsiteIntegration, WebsiteIntegrationType
    from app import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    conv_id = None
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.flush()
        db.add(Website(id=1, organization_id=1, name="Site A", domain="a.example.com", widget_key="k1"))
        owner = User(
            id=10, name="Owner A", email="owner-a@acme.com",
            password_hash=get_password_hash("testpass123"), role=UserRole.OWNER,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        )
        db.add(owner)
        db.flush()
        conv = Conversation(
            website_id=1, session_id="s1", status=ConversationStatus.OPEN,
            visitor_name="Jane", visitor_email="jane@example.com",
        )
        db.add(conv)
        db.commit()
        conv_id = conv.id
        owner_id = owner.id
    finally:
        db.close()

    client = TestClient(app)
    # Mint the JWT directly (like test_automation_config_scenarios.py does)
    # instead of a real /auth/login call — that endpoint is rate-limited
    # (5/min) and shared across every test file in one pytest run.
    from app.core.security import create_access_token

    token = create_access_token({"user_id": owner_id})
    return client, {"Authorization": f"Bearer {token}"}, conv_id


def test_send_lead_now_blocked_without_integrations(leads_api_env):
    client, headers, conv_id = leads_api_env

    status_resp = client.get(f"/conversations/{conv_id}/leads", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["has_integrations"] is False

    send_resp = client.post(f"/conversations/{conv_id}/leads", headers=headers, json={})
    assert send_resp.status_code == 422


def test_send_lead_now_creates_delivery_when_integration_configured(leads_api_env):
    client, headers, conv_id = leads_api_env

    client.post(
        "/websites/1/integrations/webhooks",
        headers=headers,
        json={"name": "CRM", "url": "https://hooks.example.com/crm"},
    )

    # Prevent the fire-and-forget delivery task from actually running (it'd hit
    # a real event loop here since the endpoint is async) without touching the
    # real asyncio module — patching asyncio.get_running_loop directly would
    # clobber the TestClient's own live event loop and hang the whole request.
    with patch("app.services.lead_integration_service._attempt_delivery", new=AsyncMock()):
        send_resp = client.post(f"/conversations/{conv_id}/leads", headers=headers, json={})
    assert send_resp.status_code == 200, send_resp.text

    status_resp = client.get(f"/conversations/{conv_id}/leads", headers=headers)
    body = status_resp.json()
    assert body["has_integrations"] is True
    assert len(body["deliveries"]) == 1
    assert body["deliveries"][0]["status"] == "pending"


def test_send_lead_now_requires_contact_details(leads_api_env):
    from app.core.database import SessionLocal
    from app.models.conversation import Conversation

    client, headers, conv_id = leads_api_env

    db = SessionLocal()
    try:
        conv = db.query(Conversation).filter_by(id=conv_id).first()
        conv.visitor_name = None
        conv.visitor_email = None
        conv.visitor_phone = None
        db.commit()
    finally:
        db.close()

    client.post(
        "/websites/1/integrations/webhooks",
        headers=headers,
        json={"name": "CRM", "url": "https://hooks.example.com/crm"},
    )
    resp = client.post(f"/conversations/{conv_id}/leads", headers=headers, json={})
    assert resp.status_code == 422


def test_resend_delivery_endpoint(leads_api_env):
    client, headers, conv_id = leads_api_env

    created = client.post(
        "/websites/1/integrations/webhooks",
        headers=headers,
        json={"name": "CRM", "url": "https://hooks.example.com/crm"},
    )
    with patch("app.services.lead_integration_service._attempt_delivery", new=AsyncMock()):
        client.post(f"/conversations/{conv_id}/leads", headers=headers, json={})

    status_resp = client.get(f"/conversations/{conv_id}/leads", headers=headers)
    delivery_id = status_resp.json()["deliveries"][0]["id"]

    with patch("app.services.lead_integration_service._push_webhook", return_value=None), \
         patch("app.services.lead_integration_service._fire_lead_delivered_trigger", new=AsyncMock()):
        resend_resp = client.post(
            f"/conversations/{conv_id}/leads/deliveries/{delivery_id}/resend", headers=headers,
        )
    assert resend_resp.status_code == 200, resend_resp.text
    assert resend_resp.json()["status"] == "sent"
