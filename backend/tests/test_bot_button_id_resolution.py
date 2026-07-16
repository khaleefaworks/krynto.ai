"""AUT1: bot button clicks must resolve by stable id, not array position.

Covers the two pure functions that carry the fix — _resolve_button_at_path
(id-based lookup) and _ensure_button_ids (backfill for buttons saved before
ids existed) — without needing a DB-backed Automation.
"""
from app.models.automation import Automation
from app.services.conversation_orchestrator import _resolve_button_at_path, _ensure_button_ids


def test_resolve_by_id_survives_reorder():
    buttons = [
        {"id": "a", "label": "Office Space"},
        {"id": "b", "label": "Investments"},
        {"id": "c", "label": "Careers"},
    ]
    # Visitor saw this order and clicked "Investments" (id "b", then at index 1).
    btn, _ = _resolve_button_at_path(buttons, ["b"])
    assert btn is not None and btn["label"] == "Investments"

    # Editor reorders — "b" now sits at index 0. A stale click referencing id
    # "b" must still resolve to "Investments", never whatever now sits at index 1.
    reordered = [buttons[1], buttons[0], buttons[2]]
    btn2, _ = _resolve_button_at_path(reordered, ["b"])
    assert btn2 is not None and btn2["label"] == "Investments"


def test_resolve_deleted_id_returns_none_not_wrong_button():
    buttons = [{"id": "a", "label": "Office Space"}]
    btn, parent = _resolve_button_at_path(buttons, ["deleted-id"])
    assert btn is None and parent is None


def test_resolve_nested_sub_prompt_by_id():
    buttons = [{
        "id": "careers",
        "label": "Careers",
        "sub_prompt": {
            "message": "Which team?",
            "buttons": [
                {"id": "eng", "label": "Engineering"},
                {"id": "sales", "label": "Sales"},
            ],
        },
    }]
    btn, parent_sub = _resolve_button_at_path(buttons, ["careers", "sales"])
    assert btn is not None and btn["label"] == "Sales"
    assert parent_sub is buttons[0]["sub_prompt"]


class _FakeDb:
    def __init__(self):
        self.committed = False

    def commit(self):
        self.committed = True


def test_ensure_button_ids_backfills_only_whats_missing_and_commits_once():
    automation = Automation(nodes=[{
        "type": "bot_prompt_buttons",
        "config": {"buttons": [
            {"label": "Office Space"},  # predates ids
            {"id": "already-has-one", "label": "Investments"},
        ]},
    }])
    db = _FakeDb()
    _ensure_button_ids(db, automation)

    buttons = automation.nodes[0]["config"]["buttons"]
    assert buttons[0]["id"]  # backfilled
    assert buttons[1]["id"] == "already-has-one"  # untouched
    assert db.committed is True

    # Second pass: nothing missing, no unnecessary write.
    db2 = _FakeDb()
    _ensure_button_ids(db2, automation)
    assert db2.committed is False


if __name__ == "__main__":
    test_resolve_by_id_survives_reorder()
    test_resolve_deleted_id_returns_none_not_wrong_button()
    test_resolve_nested_sub_prompt_by_id()
    test_ensure_button_ids_backfills_only_whats_missing_and_commits_once()
    print("OK")
