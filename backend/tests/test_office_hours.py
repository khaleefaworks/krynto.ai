from datetime import datetime, timezone

from app.services.office_hours import is_within_office_hours


def test_office_hours_disabled_allows_chat() -> None:
    assert is_within_office_hours({}) is True
    assert is_within_office_hours({"office_hours": {"enabled": False}}) is True


def test_office_hours_enabled_blocks_outside_interval() -> None:
    cfg = {
        "office_hours": {
            "enabled": True,
            "timezone": "UTC",
            "schedule": {
                "mon": [{"start": "08:00", "end": "17:00"}],
                "tue": [],
                "wed": [],
                "thu": [],
                "fri": [],
                "sat": [],
                "sun": [],
            },
        }
    }

    # Monday 07:59 UTC -> outside
    now = datetime(2026, 1, 5, 7, 59, tzinfo=timezone.utc)  # Monday
    assert is_within_office_hours(cfg, now_utc=now) is False

    # Monday 08:00 UTC -> inside
    now = datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc)
    assert is_within_office_hours(cfg, now_utc=now) is True

    # Monday 16:59 UTC -> inside
    now = datetime(2026, 1, 5, 16, 59, tzinfo=timezone.utc)
    assert is_within_office_hours(cfg, now_utc=now) is True

    # Monday 17:00 UTC -> end is exclusive
    now = datetime(2026, 1, 5, 17, 0, tzinfo=timezone.utc)
    assert is_within_office_hours(cfg, now_utc=now) is False
