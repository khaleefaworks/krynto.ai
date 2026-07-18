"""AU3 Phase 1: security_events repo — insert helper + filtered listing."""
import pytest


@pytest.fixture()
def db_session():
    from app.core.database import init_db, SessionLocal

    init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_log_security_event_inserts_and_returns_row(db_session):
    from app.repos import security_events as security_events_repo

    event = security_events_repo.log_security_event(
        db_session,
        event_type="login_success",
        actor_user_id=1,
        organization_id=2,
        ip_address="1.2.3.4",
        metadata={"foo": "bar"},
    )

    assert event is not None
    assert event.id is not None
    assert event.event_type == "login_success"
    assert event.actor_user_id == 1
    assert event.organization_id == 2
    assert event.ip_address == "1.2.3.4"
    assert event.event_metadata == {"foo": "bar"}


class _RaisingDb:
    def add(self, obj):
        pass

    def commit(self):
        raise RuntimeError("db unavailable")

    def rollback(self):
        pass


def test_log_security_event_swallows_errors_and_returns_none():
    from app.repos import security_events as security_events_repo

    result = security_events_repo.log_security_event(_RaisingDb(), event_type="login_failed")
    assert result is None


def test_list_events_filters_by_org_type_actor_and_date(db_session):
    from datetime import datetime, timedelta, timezone

    from app.repos import security_events as security_events_repo

    # Dedicated, collision-safe ids: this test suite shares one in-memory DB
    # across every test file (StaticPool), and organization_id=1/2 are real
    # ids other files' login/role/org-update flows can now also write
    # SecurityEvent rows against, since that product code is instrumented.
    org_a, org_b = 88801, 88802
    actor_a, actor_b = 888010, 888011

    security_events_repo.log_security_event(
        db_session, event_type="login_failed", organization_id=org_a, actor_user_id=None, target_user_id=5
    )
    security_events_repo.log_security_event(
        db_session, event_type="role_changed", organization_id=org_a, actor_user_id=actor_a, target_user_id=5
    )
    security_events_repo.log_security_event(
        db_session, event_type="role_changed", organization_id=org_b, actor_user_id=actor_b, target_user_id=6
    )

    rows, total = security_events_repo.list_events(db_session, organization_id=org_a)
    assert total == 2
    assert {r.event_type for r in rows} == {"login_failed", "role_changed"}

    rows, total = security_events_repo.list_events(
        db_session, event_type="role_changed", organization_id=org_a
    )
    assert total == 1
    assert rows[0].actor_user_id == actor_a

    rows, total = security_events_repo.list_events(db_session, actor_user_id=actor_a)
    assert total == 1
    assert rows[0].organization_id == org_a

    future = datetime.now(timezone.utc) + timedelta(days=1)
    rows, total = security_events_repo.list_events(db_session, organization_id=org_a, date_from=future)
    assert total == 0


def test_list_events_respects_limit_and_offset_but_total_counts_all(db_session):
    from app.repos import security_events as security_events_repo

    org_id = 88888  # dedicated id, unused by any other test in this file
    for i in range(5):
        security_events_repo.log_security_event(db_session, event_type="login_failed", organization_id=org_id)

    rows, total = security_events_repo.list_events(db_session, organization_id=org_id, limit=2, offset=0)
    assert total == 5
    assert len(rows) == 2
