"""Tests for CC1's per-card fill state:
  - contact_card_state (message_presenter) is pending/filled/expired
  - a newer contact-card message in the same conversation supersedes the old one
  - a resolved conversation expires any still-pending card
  - submit_form enforces the same rule it displays (can't drift apart)
"""
import json

import pytest


@pytest.fixture()
def card_env():
    from app.core.database import Base, engine, SessionLocal
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.website_form import WebsiteForm
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
        form = WebsiteForm(
            website_id=1, name="Contact", slug="contact",
            fields=[{"name": "name", "label": "Name", "field_type": "text", "required": True}],
            enabled=True, is_contact_card=True,
        )
        db.add(form)
        db.flush()
        db.commit()
        yield db, conv.id, form.id
    finally:
        db.close()


def _make_contact_card_message(db, conversation_id, form_id):
    from app.models.message import Message, MessageSenderType

    msg = Message(
        conversation_id=conversation_id,
        sender_type=MessageSenderType.AGENT,
        sender="10",
        event_type="contact_card",
        content=json.dumps({
            "message": 'Agent requested you to fill the form:',
            "form_id": form_id, "form_name": "Contact", "fields": [], "submit_label": "Send",
        }),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def test_contact_card_state_pending_by_default(card_env):
    db, conv_id, form_id = card_env
    from app.core.message_presenter import contact_card_state

    msg = _make_contact_card_message(db, conv_id, form_id)
    assert contact_card_state(db, msg) == {"status": "pending"}


def test_contact_card_state_filled_after_submission(card_env):
    db, conv_id, form_id = card_env
    from app.core.message_presenter import contact_card_state
    from app.repos import forms as forms_repo

    msg = _make_contact_card_message(db, conv_id, form_id)
    forms_repo.create_submission(db, form_id=form_id, data={"name": "Jane"}, conversation_id=conv_id, message_id=msg.id)

    state = contact_card_state(db, msg)
    assert state["status"] == "filled"
    assert state["data"]["name"] == "Jane"


def test_contact_card_state_expired_when_superseded(card_env):
    db, conv_id, form_id = card_env
    from app.core.message_presenter import contact_card_state

    msg1 = _make_contact_card_message(db, conv_id, form_id)
    msg2 = _make_contact_card_message(db, conv_id, form_id)

    assert contact_card_state(db, msg1) == {"status": "expired", "reason": "superseded"}
    assert contact_card_state(db, msg2) == {"status": "pending"}


def test_contact_card_state_expired_when_resolved(card_env):
    db, conv_id, form_id = card_env
    from app.core.message_presenter import contact_card_state
    from app.models.conversation import Conversation, ConversationStatus

    msg = _make_contact_card_message(db, conv_id, form_id)
    conv = db.query(Conversation).filter_by(id=conv_id).first()
    conv.status = ConversationStatus.RESOLVED
    db.commit()

    assert contact_card_state(db, msg) == {"status": "expired", "reason": "resolved"}


def test_submit_form_rejects_superseded_card(card_env):
    db, conv_id, form_id = card_env
    from fastapi.testclient import TestClient
    from app.main import app

    msg1 = _make_contact_card_message(db, conv_id, form_id)
    _make_contact_card_message(db, conv_id, form_id)  # supersedes msg1

    client = TestClient(app)
    resp = client.post(
        f"/websites/1/forms/{form_id}/submissions",
        json={"data": {"name": "Jane"}, "conversation_id": conv_id, "message_id": msg1.id},
    )
    assert resp.status_code == 409


def test_submit_form_accepts_latest_pending_card(card_env):
    db, conv_id, form_id = card_env
    from fastapi.testclient import TestClient
    from app.main import app

    msg = _make_contact_card_message(db, conv_id, form_id)

    client = TestClient(app)
    resp = client.post(
        f"/websites/1/forms/{form_id}/submissions",
        json={"data": {"name": "Jane"}, "conversation_id": conv_id, "message_id": msg.id},
    )
    assert resp.status_code == 201

    from app.core.message_presenter import contact_card_state
    db.refresh(msg)
    assert contact_card_state(db, msg)["status"] == "filled"
