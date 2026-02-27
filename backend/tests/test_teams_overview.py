from datetime import datetime

import pytest


@pytest.fixture()
def client_and_seeded_db():
    # Import inside the fixture so conftest's env defaults apply first.
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import init_db, SessionLocal
    from app.models.website import Website
    from app.models.user import User, UserRole
    from app.models.agent_website_assignment import AgentWebsiteAssignment

    init_db()

    db = SessionLocal()
    try:
        # Minimal website required for auth-scoped endpoints.
        if not db.query(Website).filter_by(id=1).first():
            db.add(Website(id=1, name="Test Site", domain="test.local"))

        # Minimal agent user required for JWT auth.
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
            db.commit()

        # Ensure agent 1 is assigned to website 1.
        existing_assignment = (
            db.query(AgentWebsiteAssignment)
            .filter(AgentWebsiteAssignment.agent_id == 1, AgentWebsiteAssignment.website_id == 1)
            .first()
        )
        if not existing_assignment:
            db.add(AgentWebsiteAssignment(agent_id=1, website_id=1))
            db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        yield client


def test_teams_overview_scoped_for_agent(client_and_seeded_db):
    from app.core.database import SessionLocal
    from app.models.website import Website
    from app.models.user import User

    client = client_and_seeded_db

    # Add a second website (agent 1 is NOT assigned to it).
    db = SessionLocal()
    try:
        if not db.query(Website).filter_by(id=2).first():
            db.add(Website(id=2, name="Second Site", domain="second.local"))
        # Mark agent heartbeat as fresh so they are connected.
        db.query(User).filter_by(id=1).update({"last_heartbeat_at": datetime.utcnow()})
        db.commit()
    finally:
        db.close()

    # Agent auth comes from fixture WS/HTTP token logic in other tests; for this
    # lightweight check we reuse the same JWT creation as other tests.
    from app.core.security import create_access_token

    token = create_access_token({"user_id": 1})

    resp = client.get(
        "/teams/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)

    website_ids = {int(w.get("id")) for w in data}
    assert 1 in website_ids
    assert 2 not in website_ids


def test_teams_overview_unrestricted_for_admin(client_and_seeded_db):
    from app.core.database import SessionLocal
    from app.models.website import Website
    from app.models.user import User, UserRole

    client = client_and_seeded_db

    db = SessionLocal()
    try:
        if not db.query(Website).filter_by(id=2).first():
            db.add(Website(id=2, name="Second Site", domain="second.local"))
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

    from app.core.security import create_access_token

    token = create_access_token({"user_id": 2})

    resp = client.get(
        "/teams/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)

    website_ids = {int(w.get("id")) for w in data}
    assert 1 in website_ids
    assert 2 in website_ids
