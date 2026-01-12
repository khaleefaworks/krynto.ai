from fastapi.testclient import TestClient

from app.main import app


def test_request_id_is_propagated_when_header_present():
    client = TestClient(app)
    resp = client.get("/health/live", headers={"X-Request-ID": "req-123"})
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID") == "req-123"


def test_request_id_is_generated_when_missing():
    client = TestClient(app)
    resp = client.get("/health/live")
    assert resp.status_code == 200
    rid = resp.headers.get("X-Request-ID")
    assert isinstance(rid, str)
    assert len(rid) > 0


def test_metrics_endpoint_exposes_prometheus_text():
    client = TestClient(app)
    # Generate at least one request observation.
    client.get("/health/live")

    resp = client.get("/metrics")
    assert resp.status_code == 200
    body = resp.text
    assert "http_requests_total" in body
    assert "ws_connections" in body
