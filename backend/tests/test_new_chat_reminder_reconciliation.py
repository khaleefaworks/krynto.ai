"""Startup reconciliation (app/main.py _reconcile_new_chat_reminders) must only
resume the 'new chat unclaimed' reminder loop for conversations that actually
had one running — i.e. conversations with at least one real visitor message.

Without this check, restarting the backend resumes the nagging reminder loop
for a merely-connected, never-engaged visitor (the welcome message's buttons
sitting unclicked) too, since it otherwise matches on nothing but
open + unassigned + recent + not bot_only.

This test exercises the same query construction directly against a real DB
(the closure in main.py isn't exported, so we mirror its filter here) rather
than reimplementing the whole app lifespan.
"""
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture()
def conv_env():
    from app.core.database import Base, engine, SessionLocal
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.message import Message, MessageSenderType
    from app import models  # noqa: F401 — ensure metadata is complete

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.flush()
        db.add(Website(id=1, organization_id=1, name="Site A", domain="a.example.com", widget_key="k1"))
        db.flush()

        now = datetime.now(timezone.utc)

        engaged = Conversation(
            website_id=1, session_id="s-engaged", status=ConversationStatus.OPEN,
            created_at=now - timedelta(minutes=5),
        )
        untouched = Conversation(
            website_id=1, session_id="s-untouched", status=ConversationStatus.OPEN,
            created_at=now - timedelta(minutes=5),
        )
        db.add_all([engaged, untouched])
        db.flush()

        db.add(Message(
            conversation_id=engaged.id, sender_type=MessageSenderType.VISITOR,
            content="Investments",
        ))
        db.commit()

        yield db, engaged.id, untouched.id
    finally:
        db.close()


def test_reconciliation_only_matches_conversations_with_visitor_engagement(conv_env):
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.message import Message, MessageSenderType

    db, engaged_id, untouched_id = conv_env

    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    visitor_msg_exists = (
        db.query(Message.id)
        .filter(Message.conversation_id == Conversation.id, Message.sender_type == MessageSenderType.VISITOR)
        .exists()
    )
    matched_ids = {
        c.id for c in db.query(Conversation).filter(
            Conversation.status == ConversationStatus.OPEN,
            Conversation.assigned_agent_id.is_(None),
            Conversation.visitor_ended == False,  # noqa: E712
            Conversation.bot_only == False,  # noqa: E712
            Conversation.created_at >= cutoff,
            visitor_msg_exists,
        ).all()
    }

    assert engaged_id in matched_ids
    assert untouched_id not in matched_ids
