"""Tests for the lead integration pipeline (CC1 forms -> outbound webhook):
  - enqueue_lead creates a pending delivery per enabled webhook
  - dedup: the offline gate's visitor_contact frame + its attached contact-card
    form submission must not double-push the same conversation's lead
  - _push_webhook posts the raw payload, plus a plain "secret" field when one
    is configured (no HMAC header — most no-code/sandboxed receivers can't
    compute one, see lead_integration_service.py's _push_webhook docstring)
  - the webhook CRUD API (create/update/delete/list) is admin-only and
    never echoes a saved secret back
  - WebsiteForm.is_contact_card is exclusive per website (API layer)
"""
from unittest.mock import patch

import json

import pytest


@pytest.fixture()
def lead_env():
    from app.core.database import Base, engine, SessionLocal
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation, ConversationStatus
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
        db.flush()

        integration = WebsiteIntegration(
            website_id=1,
            type=WebsiteIntegrationType.WEBHOOK,
            name="Test webhook",
            enabled=True,
            config={"url": "https://hooks.example.com/lead", "secret": "s3cr3t"},
        )
        db.add(integration)
        db.commit()

        yield db, conv.id, integration.id
    finally:
        db.close()


def test_enqueue_lead_noop_when_no_integrations():
    from app.core.database import Base, engine, SessionLocal
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app import models  # noqa: F401
    from app.services.lead_integration_service import enqueue_lead
    from app.repos import lead_integration_deliveries as deliveries_repo

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.flush()
        db.add(Website(id=1, organization_id=1, name="Site A", domain="a.example.com", widget_key="k1"))
        db.commit()

        enqueue_lead(db, website_id=1, source="offline_gate", name="Jane", email=None, phone="9999999999")
        assert deliveries_repo.find_pending_retries(db) == []
    finally:
        db.close()


def test_enqueue_lead_creates_pending_delivery(lead_env):
    db, conv_id, integration_id = lead_env
    from app.services.lead_integration_service import enqueue_lead
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    enqueue_lead(
        db, website_id=1, conversation_id=conv_id, source="offline_gate",
        name="Jane", email="jane@example.com", phone="9999999999",
    )
    rows = db.query(LeadIntegrationDelivery).filter_by(conversation_id=conv_id).all()
    assert len(rows) == 1
    assert rows[0].integration_id == integration_id
    assert rows[0].payload["name"] == "Jane"
    assert rows[0].payload["email"] == "jane@example.com"


def test_enqueue_lead_dedups_within_window(lead_env):
    """The offline gate's visitor_contact frame AND its attached contact-card
    form submission both call enqueue_lead for the same overlay submit —
    only one delivery must be created."""
    db, conv_id, _integration_id = lead_env
    from app.services.lead_integration_service import enqueue_lead
    from app.models.lead_integration_delivery import LeadIntegrationDelivery

    enqueue_lead(db, website_id=1, conversation_id=conv_id, source="offline_gate", name="Jane", phone="9999999999")
    enqueue_lead(db, website_id=1, conversation_id=conv_id, source="live_chat_form", name="Jane", phone="9999999999")

    rows = db.query(LeadIntegrationDelivery).filter_by(conversation_id=conv_id).all()
    assert len(rows) == 1


def test_push_webhook_sends_raw_payload_with_secret_field():
    from app.services.lead_integration_service import _push_webhook

    captured = {}

    class _FakeResponse:
        def raise_for_status(self):
            pass

    def fake_post(url, data, headers, timeout):
        captured["url"] = url
        captured["data"] = data
        captured["headers"] = headers
        return _FakeResponse()

    payload = {"name": "Jane", "email": "jane@example.com", "phone": "9999999999", "extra_fields": {"company": "Acme"}}

    with patch("app.services.lead_integration_service._requests.post", side_effect=fake_post):
        _push_webhook({"url": "https://hooks.example.com/lead", "secret": "s3cr3t"}, payload)

    assert captured["url"] == "https://hooks.example.com/lead"
    assert captured["headers"]["Content-Type"] == "application/json"
    sent = json.loads(captured["data"])
    # Sent as-is plus a plain "secret" field — no field-mapping/transform
    # layer (that's the receiver's job), and no HMAC header since most
    # no-code/sandboxed receivers (Frappe Server Scripts, Zapier, ...) can't
    # compute one but can do a plain string comparison.
    assert sent == {**payload, "secret": "s3cr3t"}


def test_push_webhook_without_secret_omits_secret_field():
    from app.services.lead_integration_service import _push_webhook

    captured = {}

    class _FakeResponse:
        def raise_for_status(self):
            pass

    def fake_post(url, data, headers, timeout):
        captured["data"] = data
        return _FakeResponse()

    with patch("app.services.lead_integration_service._requests.post", side_effect=fake_post):
        _push_webhook({"url": "https://hooks.example.com/lead"}, {"name": "Jane"})

    assert json.loads(captured["data"]) == {"name": "Jane"}


def test_push_webhook_raises_without_url():
    from app.services.lead_integration_service import _push_webhook

    with pytest.raises(ValueError):
        _push_webhook({}, {"name": "Jane"})


def test_webhook_crud_via_api(forms_api_env):
    client, headers = forms_api_env

    created = client.post(
        "/websites/1/integrations/webhooks",
        headers=headers,
        json={"name": "Zapier", "url": "https://hooks.zapier.com/abc", "secret": "topsecret"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    integration_id = body["id"]
    assert body["name"] == "Zapier"
    assert body["config"]["secret_set"] is True
    assert "secret" not in body["config"]

    listed = client.get("/websites/1/integrations", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    # Saving without a new secret must keep the existing one, not blank it out.
    updated = client.patch(
        f"/websites/1/integrations/webhooks/{integration_id}",
        headers=headers,
        json={"url": "https://hooks.zapier.com/def"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["config"]["url"] == "https://hooks.zapier.com/def"
    assert updated.json()["config"]["secret_set"] is True

    deleted = client.delete(f"/websites/1/integrations/webhooks/{integration_id}", headers=headers)
    assert deleted.status_code == 200

    listed_after = client.get("/websites/1/integrations", headers=headers)
    assert listed_after.json() == []


@pytest.fixture()
def forms_api_env():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import Base, engine, SessionLocal
    from app.core.security import get_password_hash
    from app.models.user import User, UserRole
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.flush()
        db.add(Website(id=1, organization_id=1, name="Site A", domain="a.example.com", widget_key="k1"))
        db.add(User(
            id=10, name="Owner A", email="owner-a@acme.com",
            password_hash=get_password_hash("testpass123"), role=UserRole.OWNER,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    login = client.post("/auth/login", json={"email": "owner-a@acme.com", "password": "testpass123"})
    token = login.json()["access_token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_is_contact_card_exclusive_per_website(forms_api_env):
    client, headers = forms_api_env

    r1 = client.post(
        "/websites/1/forms",
        headers=headers,
        json={"name": "Form A", "slug": "form-a", "fields": [{"name": "name", "label": "Name"}], "is_contact_card": True},
    )
    assert r1.status_code == 201, r1.text
    form_a_id = r1.json()["id"]

    r2 = client.post(
        "/websites/1/forms",
        headers=headers,
        json={"name": "Form B", "slug": "form-b", "fields": [{"name": "name", "label": "Name"}], "is_contact_card": True},
    )
    assert r2.status_code == 201, r2.text

    # Form A must have been un-flagged when Form B became the contact card.
    got_a = client.get(f"/websites/1/forms/{form_a_id}", headers=headers)
    assert got_a.json()["is_contact_card"] is False
    assert r2.json()["is_contact_card"] is True


def test_contact_card_public_endpoint_returns_configured_form(forms_api_env):
    client, headers = forms_api_env
    client.post(
        "/websites/1/forms",
        headers=headers,
        json={"name": "Contact", "slug": "contact", "fields": [{"name": "name", "label": "Name", "required": True}], "is_contact_card": True},
    )
    resp = client.get("/websites/1/forms/contact-card")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Contact"


def test_contact_card_public_endpoint_returns_null_when_none_configured(forms_api_env):
    client, _headers = forms_api_env
    resp = client.get("/websites/1/forms/contact-card")
    assert resp.status_code == 200
    assert resp.json() is None


def test_forms_for_agent_endpoint_reachable_by_plain_agent(forms_api_env):
    """The dashboard's "#" contact-card menu is populated from this endpoint —
    a plain AGENT (not just OWNER/MANAGER) assigned to the website must be
    able to call it, since agents are exactly who sees the composer button.
    A website can have N forms, so this returns all enabled ones, not a
    single designated "the" contact card.

    Mints the JWT directly (like test_automation_config_scenarios.py does)
    instead of a second /auth/login call — that endpoint is rate-limited
    (5/min) and the suite already spends most of that budget on other tests
    sharing the same test-client IP within one run.
    """
    from app.core.database import SessionLocal
    from app.core.security import get_password_hash, create_access_token
    from app.models.user import User, UserRole
    from app.models.agent_website_assignment import AgentWebsiteAssignment

    client, admin_headers = forms_api_env

    client.post(
        "/websites/1/forms",
        headers=admin_headers,
        json={"name": "Contact", "slug": "contact", "fields": [{"name": "name", "label": "Name"}], "is_contact_card": True},
    )
    client.post(
        "/websites/1/forms",
        headers=admin_headers,
        json={"name": "Feedback", "slug": "feedback", "fields": [{"name": "message", "label": "Message"}]},
    )

    db = SessionLocal()
    try:
        db.add(User(
            id=20, name="Agent A", email="agent-a@acme.com",
            password_hash=get_password_hash("testpass123"), role=UserRole.AGENT,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.flush()
        db.add(AgentWebsiteAssignment(agent_id=20, website_id=1))
        db.commit()
    finally:
        db.close()

    token = create_access_token({"user_id": 20})
    agent_headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/websites/1/forms/for-agent", headers=agent_headers)
    assert resp.status_code == 200, resp.text
    names = {f["name"] for f in resp.json()}
    assert names == {"Contact", "Feedback"}
