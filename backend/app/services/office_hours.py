from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timezone
from typing import Any, Iterable

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore


_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# Backward-compatible timezone aliases.
# Some browsers (and older configs) emit deprecated IANA names that may not be
# present in the server's tzdata/zoneinfo build.
_TZ_ALIASES: dict[str, str] = {
    "Asia/Calcutta": "Asia/Kolkata",
}


@dataclass(frozen=True)
class OfficeHoursInterval:
    start: time
    end: time


def _parse_hhmm(value: Any) -> time | None:
    s = str(value or "").strip()
    if not s:
        return None

    # Accept HH:MM and HH:MM:SS but store HH:MM precision.
    parts = s.split(":")
    if len(parts) < 2:
        return None

    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except Exception:
        return None

    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None

    return time(hour=hours, minute=minutes)


def _coerce_intervals(raw: Any) -> list[OfficeHoursInterval]:
    if not isinstance(raw, list):
        return []

    intervals: list[OfficeHoursInterval] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = _parse_hhmm(item.get("start"))
        end = _parse_hhmm(item.get("end"))
        if not start or not end:
            continue
        # Ignore invalid or cross-midnight intervals.
        if end <= start:
            continue
        intervals.append(OfficeHoursInterval(start=start, end=end))

    return intervals


def _iter_day_intervals(schedule: Any, weekday: int) -> Iterable[OfficeHoursInterval]:
    if not isinstance(schedule, dict):
        return []

    key = _DAY_KEYS[int(weekday) % 7]
    return _coerce_intervals(schedule.get(key))


def is_within_office_hours(widget_config: dict | None, *, now_utc: datetime | None = None) -> bool:
    """Return True when chat should be allowed based on configured office hours.

    Convention:
    - If office hours is not enabled or not configured, this returns True.
    - If enabled, this returns True only when current local time is within any
      interval for the current weekday.

    Data shape stored in widget_config:
    {
      "office_hours": {
        "enabled": true,
        "timezone": "Europe/London",
        "schedule": {
          "mon": [{"start": "08:00", "end": "17:00"}],
          ...
        }
      }
    }
    """
    config = widget_config or {}
    office_hours = config.get("office_hours")
    if not isinstance(office_hours, dict):
        return True

    if office_hours.get("enabled") is not True:
        return True

    schedule = office_hours.get("schedule")

    tz_name = str(office_hours.get("timezone") or "").strip() or "UTC"
    tz_name = _TZ_ALIASES.get(tz_name, tz_name)

    now_utc = now_utc or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = None

    if tz is None:
        # Fallback: treat as UTC if timezone is invalid/unavailable.
        tz = timezone.utc

    now_local = now_utc.astimezone(tz)
    weekday = now_local.weekday()  # Monday=0
    now_t = now_local.timetz().replace(tzinfo=None)

    for interval in _iter_day_intervals(schedule, weekday):
        # Start inclusive, end exclusive (exactly at end -> offline).
        if interval.start <= now_t < interval.end:
            return True

    return False
