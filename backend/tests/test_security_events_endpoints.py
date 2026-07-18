"""AU3 Phase 1 + SA1 system-health: HTTP-level tests for the new admin endpoints
and for the security-event call sites wired into auth.py / users.py / admin.py.

Uses distinctive, high-numbered ids/emails throughout: this test suite runs
every test file against one shared in-memory SQLite DB (StaticPool), and other
files already seed low ids like User(id=1)/Organization(id=1) with dummy
password hashes — reusing those here would make login-flow assertions
order-dependent on which file happened to seed first.
"""
import pytest

_ORG_ID = 910001
_ADMIN_ID = 910002
_AGENT_ID = 910003
_LOCKOUT_AGENT_ID = 910004


@pytest.fixture()
def client_and_seeded_db():
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import init_db, SessionLocal
    from app.core.security import get_password_hash
    from app.core.limiter import limiter
    from app.models.user import User, UserRole
    from app.models.organization import Organization
    from app.models.system_settings import SystemSettings

    # The /auth/login rate limit is keyed by client address, which is the same
    # fixed "testclient" value for every TestClient in the whole pytest run —
    # other test files' login attempts share this budget. Reset it so this
    # file's own login-flow assertions aren't order-dependent on what ran before.
    limiter.reset()

    init_db()

    db = SessionLocal()
    try:
        if not db.query(SystemSettings).filter_by(id=1).first():
            db.add(SystemSettings(id=1, is_initialized=True))
            db.commit()

        if not db.query(Organization).filter_by(id=_ORG_ID).first():
            db.add(Organization(id=_ORG_ID, name="SA1AU3 Test Org", slug="sa1au3-test-org", plan="free", is_active=True))
            db.commit()

        if not db.query(User).filter_by(id=_ADMIN_ID).first():
            db.add(
                User(
                    id=_ADMIN_ID,
                    name="SA1AU3 Administrator",
                    email="sa1au3-administrator@test.local",
                    password_hash=get_password_hash("adminpass123"),
                    role=UserRole.SYSTEM_MANAGER,
                    is_active=True,
                    is_available=True,
                    is_email_verified=True,
                )
            )
            db.commit()

        if not db.query(User).filter_by(id=_AGENT_ID).first():
            db.add(
                User(
                    id=_AGENT_ID,
                    name="SA1AU3 Agent",
                    email="sa1au3-agent@test.local",
                    password_hash=get_password_hash("agentpass123"),
                    role=UserRole.AGENT,
                    organization_id=_ORG_ID,
                    is_active=True,
                    is_available=True,
                    is_email_verified=True,
                )
            )
            db.commit()

        if not db.query(User).filter_by(id=_LOCKOUT_AGENT_ID).first():
            db.add(
                User(
                    id=_LOCKOUT_AGENT_ID,
                    name="SA1AU3 Lockout Agent",
                    email="sa1au3-lockout-agent@test.local",
                    password_hash=get_password_hash("lockoutpass123"),
                    role=UserRole.AGENT,
                    organization_id=_ORG_ID,
                    is_active=True,
                    is_available=True,
                    is_email_verified=True,
                )
            )
            db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        yield client


def _admin_token():
    from app.core.security import create_access_token

    return create_access_token({"user_id": _ADMIN_ID})


def _agent_token():
    from app.core.security import create_access_token

    return create_access_token({"user_id": _AGENT_ID})


def _event_total(db, **filters) -> int:
    from app.repos import security_events as security_events_repo

    _, total = security_events_repo.list_events(db, **filters)
    return total


def test_security_events_requires_administrator(client_and_seeded_db):
    resp = client_and_seeded_db.get(
        "/admin/security-events",
        headers={"Authorization": f"Bearer {_agent_token()}"},
    )
    assert resp.status_code == 403

    resp = client_and_seeded_db.get(
        "/admin/security-events",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    assert resp.status_code == 200
    assert "items" in resp.json()


def test_login_failures_then_lockout_produce_expected_event_types(client_and_seeded_db):
    from app.core.database import SessionLocal
    from app.repos import security_events as security_events_repo

    # 2 plain failures, then the 3rd crosses the 5-minute-lockout threshold.
    for _ in range(3):
        resp = client_and_seeded_db.post(
            "/auth/login", json={"email": "sa1au3-lockout-agent@test.local", "password": "wrong-password"}
        )
        assert resp.status_code == 401

    db = SessionLocal()
    try:
        rows, total = security_events_repo.list_events(db, target_user_id=_LOCKOUT_AGENT_ID)
        assert total == 3
        event_types = [r.event_type for r in rows][::-1]  # oldest first
        assert event_types == ["login_failed", "login_failed", "login_lockout"]
    finally:
        db.close()


def test_successful_login_logs_login_success_event(client_and_seeded_db):
    from app.core.database import SessionLocal

    resp = client_and_seeded_db.post(
        "/auth/login", json={"email": "sa1au3-agent@test.local", "password": "agentpass123"}
    )
    assert resp.status_code == 200

    db = SessionLocal()
    try:
        total = _event_total(db, actor_user_id=_AGENT_ID, event_type="login_success")
        assert total == 1
    finally:
        db.close()


def test_role_change_logs_event_with_old_and_new_role(client_and_seeded_db):
    from app.core.database import SessionLocal

    resp = client_and_seeded_db.patch(
        f"/users/{_AGENT_ID}/role",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"role": "manager"},
    )
    assert resp.status_code == 200

    db = SessionLocal()
    try:
        from app.repos import security_events as security_events_repo

        rows, total = security_events_repo.list_events(
            db, event_type="role_changed", target_user_id=_AGENT_ID
        )
        assert total == 1
        assert rows[0].event_metadata == {"old_role": "agent", "new_role": "manager"}
    finally:
        db.close()


def test_org_update_logs_events_only_for_fields_that_actually_change(client_and_seeded_db):
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        baseline = _event_total(db, organization_id=_ORG_ID)
    finally:
        db.close()

    # Changes both plan and is_active in one call -> two distinct events.
    resp = client_and_seeded_db.patch(
        f"/admin/organizations/{_ORG_ID}",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"plan": "pro", "is_active": False},
    )
    assert resp.status_code == 200

    db = SessionLocal()
    try:
        from app.repos import security_events as security_events_repo

        rows, total = security_events_repo.list_events(db, organization_id=_ORG_ID)
        assert total == baseline + 2
        new_event_types = {r.event_type for r in rows[: total - baseline]}
        assert new_event_types == {"org_plan_changed", "org_suspended"}
    finally:
        db.close()

    # Re-sending the exact same values should be a no-op: zero new events.
    resp = client_and_seeded_db.patch(
        f"/admin/organizations/{_ORG_ID}",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"plan": "pro", "is_active": False},
    )
    assert resp.status_code == 200

    db = SessionLocal()
    try:
        total_after_noop = _event_total(db, organization_id=_ORG_ID)
        assert total_after_noop == baseline + 2
    finally:
        db.close()


def test_system_health_requires_administrator_and_reports_live_state(client_and_seeded_db):
    resp = client_and_seeded_db.get(
        "/admin/system-health",
        headers={"Authorization": f"Bearer {_agent_token()}"},
    )
    assert resp.status_code == 403

    resp = client_and_seeded_db.get(
        "/admin/system-health",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["db"] == "ok"
    assert isinstance(body["active_agent_connections"], int)
    assert isinstance(body["live_visitor_count"], int)
    assert isinstance(body["scheduler_jobs"], list)
