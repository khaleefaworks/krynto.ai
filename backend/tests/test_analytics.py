"""Tests for the REP1 analytics fixes.

Covers the two High-severity issues specifically:
  - ratings_summary was not org-scoped (multi-tenant leak)
  - _date_range() mislabeled IST midnight as UTC midnight
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest


@pytest.fixture()
def two_org_env():
    """Two orgs, each with one website and one owner, plus one rating each."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import Base, engine, SessionLocal
    from app.core.security import get_password_hash
    from app.models.user import User, UserRole
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.conversation import Conversation
    from app.models.conversation_rating import ConversationRating

    from app import models  # noqa: F401 — ensure metadata is complete
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        db.add(SystemSettings(id=1, is_initialized=True))
        db.flush()

        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.add(Organization(id=2, name="Org B", slug="org-b", plan="free", is_active=True))
        db.flush()

        password_hash = get_password_hash("testpass123")
        db.add(User(
            id=10, name="Owner A", email="owner-a@acme.com",
            password_hash=password_hash, role=UserRole.OWNER,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.flush()

        db.add(Website(id=100, name="Site A", domain="site-a.test", organization_id=1))
        db.add(Website(id=200, name="Site B", domain="site-b.test", organization_id=2))
        db.flush()

        db.query(Organization).filter_by(id=1).update({"owner_id": 10})

        db.add(Conversation(id=1, website_id=100, session_id="s-a"))
        db.add(Conversation(id=2, website_id=200, session_id="s-b"))
        db.flush()

        db.add(ConversationRating(conversation_id=1, rating=1))
        db.add(ConversationRating(conversation_id=2, rating=-1))

        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        yield client

    Base.metadata.drop_all(bind=engine)


def _auth(user_id: int) -> dict:
    from app.core.security import create_access_token
    token = create_access_token({"user_id": user_id})
    return {"Authorization": f"Bearer {token}"}


def test_ratings_summary_scoped_to_own_org(two_org_env):
    client = two_org_env
    resp = client.get(
        "/analytics/ratings/summary?start=2000-01-01&end=2099-12-31",
        headers=_auth(10),
    )
    assert resp.status_code == 200
    data = resp.json()
    # Org A's owner must see only Org A's rating (good=1), never Org B's (bad=1).
    assert data["total"] == 1
    assert data["good"] == 1
    assert data["bad"] == 0


def test_ratings_summary_rejects_other_org_website_id(two_org_env):
    client = two_org_env
    resp = client.get(
        "/analytics/ratings/summary?website_id=200&start=2000-01-01&end=2099-12-31",
        headers=_auth(10),
    )
    assert resp.status_code == 200
    data = resp.json()
    # Passing another org's website_id must not leak that org's data.
    assert data["total"] == 0


def test_date_range_boundaries_are_ist_not_utc():
    from app.api.analytics import _date_range, _IST

    d = date(2026, 7, 10)
    start_dt, end_dt = _date_range(d, d)

    assert start_dt.tzinfo == _IST
    assert end_dt.tzinfo == _IST
    assert start_dt == datetime.combine(d, time.min, tzinfo=_IST)

    # The old bug: midnight IST labeled as UTC is actually 05:30 IST, which
    # would incorrectly exclude anything before 05:30 IST on the selected day.
    midnight_ist_as_utc_instant = datetime.combine(d, time.min, tzinfo=timezone.utc)
    assert start_dt != midnight_ist_as_utc_instant
    assert start_dt < midnight_ist_as_utc_instant


def test_avail_day_bounds_are_ist_not_naive():
    from app.api.analytics import _avail_day_bounds, _IST

    d = date(2026, 7, 10)
    start_dt, end_dt = _avail_day_bounds(d)

    assert start_dt.tzinfo == _IST
    assert end_dt.tzinfo == _IST
    assert start_dt == datetime.combine(d, time.min, tzinfo=_IST)


def test_avail_day_bounds_convert_to_naive_utc_5_5_hours_earlier():
    """agent_availability() converts IST bounds to naive-UTC before comparing
    against AgentStatusLog.changed_at (a plain, naive-UTC DateTime column,
    confirmed against the live DB schema — unlike Conversation.created_at
    which is DateTime(timezone=True))."""
    from app.api.analytics import _avail_day_bounds

    d = date(2026, 7, 10)
    ist_start, _ = _avail_day_bounds(d)
    naive_utc_start = ist_start.astimezone(timezone.utc).replace(tzinfo=None)

    # IST midnight on the 10th is 18:30 UTC on the 9th.
    assert naive_utc_start == datetime(2026, 7, 9, 18, 30)
    assert naive_utc_start.tzinfo is None
