"""Tests for SA2's Alembic-revision-based backup version compatibility.

Uses the app's real migration graph as fixture data rather than a synthetic
fake alembic project — it's static, already present, and exercising the
real graph is at least as meaningful as a hand-built stand-in.
"""
from app.services.backup_service import compute_compatibility, get_current_alembic_heads


def test_current_head_is_a_match():
    heads = get_current_alembic_heads()
    assert len(heads) == 1, "expected a single migration head; multiple heads changes this test"
    assert compute_compatibility(heads[0]) == "match"


def test_ancestor_revision_is_older():
    # b2c3d4e5f6a1 (notification_events table) is a real, known ancestor of
    # the current head — added well before this backups migration.
    assert compute_compatibility("b2c3d4e5f6a1") == "older"


def test_unrecognized_revision_is_unknown():
    assert compute_compatibility("not-a-real-revision-id") == "unknown"


def test_missing_revision_is_unknown():
    assert compute_compatibility(None) == "unknown"
    assert compute_compatibility("") == "unknown"
