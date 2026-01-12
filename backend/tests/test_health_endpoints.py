from fastapi.testclient import TestClient

from app.main import app


def test_health_live_ok():
    client = TestClient(app)
    resp = client.get("/health/live")
    assert resp.status_code == 200
    assert resp.json().get("status") == "ok"


def test_health_ready_ok_with_sqlite_and_no_redis():
    client = TestClient(app)
    resp = client.get("/health/ready")
    assert resp.status_code == 200

    payload = resp.json()
    assert payload.get("status") == "ok"
    assert payload.get("db") == "ok"
    assert payload.get("redis") == "disabled"
