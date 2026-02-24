import pytest


@pytest.fixture()
def client_and_seeded_db():
    # Import inside the fixture so conftest's env defaults apply first.
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import init_db, SessionLocal
    from app.models.user import User, UserRole

    init_db()

    db = SessionLocal()
    try:
        # Ensure a bootstrap-like administrator exists.
        if not db.query(User).filter_by(id=2).first():
            db.add(
                User(
                    id=2,
                    name="Administrator",
                    email="administrator@chatassist.system",
                    password_hash="x",
                    role=UserRole.SYSTEM_MANAGER,
                    is_active=True,
                    is_available=True,
                )
            )
            db.commit()

        # Secondary administrator for tests that must avoid "cannot change your own role".
        if not db.query(User).filter_by(id=3).first():
            db.add(
                User(
                    id=3,
                    name="Administrator 2",
                    email="administrator2@chatassist.system",
                    password_hash="x",
                    role=UserRole.SYSTEM_MANAGER,
                    is_active=True,
                    is_available=True,
                )
            )
            db.commit()

        # Ensure a normal user exists for role-update tests.
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
    finally:
        db.close()

    with TestClient(app) as client:
        yield client


def test_register_rejects_system_manager_role(client_and_seeded_db):
    from app.core.security import create_access_token

    token = create_access_token({"user_id": 2})

    resp = client_and_seeded_db.post(
        "/auth/register",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Another Admin",
            "email": "another-admin@example.com",
            "password": "secret123",
            "role": "system_manager",
        },
    )

    assert resp.status_code == 400
    assert "bootstrap" in (resp.json().get("detail") or "").lower()


def test_role_update_rejects_promote_to_system_manager(client_and_seeded_db):
    from app.core.security import create_access_token

    token = create_access_token({"user_id": 2})

    resp = client_and_seeded_db.patch(
        "/users/1/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "system_manager"},
    )

    assert resp.status_code == 400
    assert "bootstrap" in (resp.json().get("detail") or "").lower()


def test_role_update_rejects_demote_system_manager(client_and_seeded_db):
    from app.core.security import create_access_token

    token = create_access_token({"user_id": 3})

    resp = client_and_seeded_db.patch(
        "/users/2/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "manager"},
    )

    assert resp.status_code == 400
    assert "cannot be changed" in (resp.json().get("detail") or "").lower()
