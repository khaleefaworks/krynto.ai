from app.infra import metrics


def test_metrics_render_includes_expected_help_lines_and_samples():
    metrics.observe_http_request(method="GET", path_template="/health/live", status_code=200, duration_ms=12.3)

    metrics.ws_connect(kind="chat")
    metrics.ws_message(kind="chat", direction="in", message_type="message")
    metrics.ws_error(kind="chat", where="handler")
    metrics.ws_disconnect(kind="chat")

    body = metrics.render_prometheus_text()

    # HELP/TYPE headers (always present)
    assert "# HELP http_requests_total" in body
    assert "# HELP ws_connections" in body
    assert "# HELP ws_messages_total" in body
    assert "# HELP ws_errors_total" in body

    # Sample lines (should be present after observations)
    assert "http_requests_total" in body
    assert "ws_connections_total" in body
    assert "ws_messages_total" in body
    assert "ws_errors_total" in body
