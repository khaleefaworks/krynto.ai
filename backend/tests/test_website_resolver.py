from datetime import datetime, timezone


def test_website_online_when_assigned_owner_is_available_and_connected():
    from app.core.database import init_db, SessionLocal
    from app.models.agent_website_assignment import AgentWebsiteAssignment
    from app.models.user import User, UserRole
    from app.models.website import Website
    from app.services.website_resolver import is_website_online

    init_db()

    db = SessionLocal()
    try:
        if not db.query(Website).filter_by(id=1).first():
            db.add(Website(id=1, name="Owner Site", domain="owner.test"))

        if not db.query(User).filter_by(id=101).first():
            db.add(
                User(
                    id=101,
                    name="Owner User",
                    email="owner@test.local",
                    password_hash="x",
                    role=UserRole.OWNER,
                    is_active=True,
                    is_available=True,
                    last_heartbeat_at=datetime.now(timezone.utc),
                    organization_id=1,
                )
            )

        if not db.query(AgentWebsiteAssignment).filter_by(agent_id=101, website_id=1).first():
            db.add(AgentWebsiteAssignment(agent_id=101, website_id=1))

        db.commit()

        assert is_website_online(1) is True
    finally:
        db.close()