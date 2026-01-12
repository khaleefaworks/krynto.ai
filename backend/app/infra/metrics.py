from __future__ import annotations

import math
import threading
from collections import defaultdict
from typing import DefaultDict, Dict, Tuple


_lock = threading.Lock()


def _safe_label(value: str | None, *, fallback: str) -> str:
    s = (value or "").strip()
    if not s:
        return fallback
    # Keep metrics label values bounded and printable.
    s = "".join(ch for ch in s if 32 <= ord(ch) <= 126)
    if not s:
        return fallback
    return s[:200]


# --- HTTP metrics ---

# Keys: (method, path_template, status)
_http_requests_total: DefaultDict[Tuple[str, str, str], int] = defaultdict(int)
_http_request_duration_ms_sum: DefaultDict[Tuple[str, str], float] = defaultdict(float)
_http_request_duration_ms_count: DefaultDict[Tuple[str, str], int] = defaultdict(int)


def observe_http_request(*, method: str, path_template: str, status_code: int, duration_ms: float) -> None:
    method = _safe_label(method, fallback="UNKNOWN")
    path_template = _safe_label(path_template, fallback="unknown")
    status = _safe_label(str(int(status_code)), fallback="0")

    # Guard against NaN/inf from weird clocks.
    if not isinstance(duration_ms, (int, float)) or not math.isfinite(duration_ms) or duration_ms < 0:
        duration_ms = 0.0

    with _lock:
        _http_requests_total[(method, path_template, status)] += 1
        _http_request_duration_ms_sum[(method, path_template)] += float(duration_ms)
        _http_request_duration_ms_count[(method, path_template)] += 1


# --- WebSocket metrics ---

_ws_connections: DefaultDict[str, int] = defaultdict(int)
_ws_connections_total: DefaultDict[str, int] = defaultdict(int)


def ws_connect(*, kind: str) -> None:
    kind = _safe_label(kind, fallback="unknown")
    with _lock:
        _ws_connections[kind] += 1
        _ws_connections_total[kind] += 1


def ws_disconnect(*, kind: str) -> None:
    kind = _safe_label(kind, fallback="unknown")
    with _lock:
        if _ws_connections[kind] > 0:
            _ws_connections[kind] -= 1


def _format_labels(labels: Dict[str, str]) -> str:
    if not labels:
        return ""
    parts = []
    for k, v in labels.items():
        v_esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        parts.append(f'{k}="{v_esc}"')
    return "{" + ",".join(parts) + "}"


def render_prometheus_text() -> str:
    lines: list[str] = []

    lines.append("# HELP http_requests_total Total number of HTTP requests")
    lines.append("# TYPE http_requests_total counter")

    lines.append("# HELP http_request_duration_ms_sum Sum of HTTP request durations in milliseconds")
    lines.append("# TYPE http_request_duration_ms_sum counter")

    lines.append("# HELP http_request_duration_ms_count Count of observed HTTP request durations")
    lines.append("# TYPE http_request_duration_ms_count counter")

    lines.append("# HELP ws_connections Current number of active WebSocket connections")
    lines.append("# TYPE ws_connections gauge")

    lines.append("# HELP ws_connections_total Total number of WebSocket connections opened")
    lines.append("# TYPE ws_connections_total counter")

    with _lock:
        for (method, path, status), value in sorted(_http_requests_total.items()):
            lines.append(
                f"http_requests_total{_format_labels({'method': method, 'path': path, 'status': status})} {value}"
            )

        for (method, path), value in sorted(_http_request_duration_ms_sum.items()):
            lines.append(
                f"http_request_duration_ms_sum{_format_labels({'method': method, 'path': path})} {value:.3f}"
            )

        for (method, path), value in sorted(_http_request_duration_ms_count.items()):
            lines.append(
                f"http_request_duration_ms_count{_format_labels({'method': method, 'path': path})} {value}"
            )

        for kind, value in sorted(_ws_connections.items()):
            lines.append(f"ws_connections{_format_labels({'kind': kind})} {value}")

        for kind, value in sorted(_ws_connections_total.items()):
            lines.append(f"ws_connections_total{_format_labels({'kind': kind})} {value}")

    lines.append("")
    return "\n".join(lines)
