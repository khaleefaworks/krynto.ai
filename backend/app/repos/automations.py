from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.automation import Automation


def _normalize_actions(*, trigger: str, actions: dict | list | None):
    """Normalize automation actions for consistent storage.

    Key goals:
    - Prefer list-of-dicts storage (even if a dict is provided).
    - Backward-compat: convert legacy resolved/reopened "events" stored as
      send_bot_message with event_type == trigger into emit_system_event.
    - Normalize emit_system_event to use `content` (allow `message` input).
    """

    if actions is None:
        return None

    if isinstance(actions, list):
        normalized = [a for a in actions if isinstance(a, dict)]
    elif isinstance(actions, dict):
        normalized = [actions]
    else:
        # Leave unknown types untouched; service layer can still attempt to parse.
        return actions

    out: list[dict] = []
    for action in normalized:
        action_type = str(action.get("type") or "").strip()

        # Backward-compat: some clients used `content` for bot messages.
        if action_type == "send_bot_message" and action.get("message") is None and action.get("content") is not None:
            cleaned = dict(action)
            cleaned["message"] = cleaned.get("content")
            cleaned.pop("content", None)
            action = cleaned

        # Ensure welcome idempotency stays stable even if UI forgets.
        if trigger == "visitor_connected" and action_type == "send_bot_message":
            if not action.get("event_type"):
                action = {**action, "event_type": "automation_welcome"}

        # Convert legacy resolved/reopened events stored as send_bot_message.
        if (
            trigger in {"conversation_resolved", "conversation_reopened"}
            and action_type == "send_bot_message"
            and isinstance(action.get("event_type"), str)
            and action.get("event_type").strip() == trigger
        ):
            msg = action.get("message")
            if msg is None:
                msg = action.get("content")
            out.append(
                {
                    "type": "emit_system_event",
                    "content": msg,
                    "event_type": trigger,
                }
            )
            continue

        # Normalize emit_system_event: always store content.
        if action_type == "emit_system_event":
            content = action.get("content")
            if content is None:
                content = action.get("message")
            cleaned = dict(action)
            cleaned.pop("message", None)
            cleaned["content"] = content
            out.append(cleaned)
            continue

        out.append(action)

    return out


def list_automations(db: Session, *, website_id: int) -> List[Automation]:
    return (
        db.query(Automation)
        .filter(Automation.website_id == website_id)
        .order_by(Automation.id.asc())
        .all()
    )


def get_automation(db: Session, *, automation_id: int, website_id: int | None = None) -> Optional[Automation]:
    query = db.query(Automation).filter(Automation.id == automation_id)
    if website_id is not None:
        query = query.filter(Automation.website_id == website_id)
    return query.first()


def create_automation(
    db: Session,
    *,
    website_id: int,
    name: str,
    trigger: str,
    enabled: bool = True,
    conditions: dict | None = None,
    actions: dict | list | None = None,
) -> Automation:
    actions = _normalize_actions(trigger=trigger, actions=actions)
    automation = Automation(
        website_id=website_id,
        name=name,
        trigger=trigger,
        enabled=bool(enabled),
        conditions=conditions or {},
        actions=actions or {},
    )
    db.add(automation)
    db.commit()
    db.refresh(automation)
    return automation


def update_automation(
    db: Session,
    *,
    automation: Automation,
    name: str | None = None,
    trigger: str | None = None,
    enabled: bool | None = None,
    conditions: dict | None = None,
    actions: dict | list | None = None,
) -> Automation:
    if name is not None:
        automation.name = name
    if trigger is not None:
        automation.trigger = trigger
    if enabled is not None:
        automation.enabled = bool(enabled)
    if conditions is not None:
        automation.conditions = conditions
    if actions is not None:
        next_trigger = trigger if trigger is not None else automation.trigger
        automation.actions = _normalize_actions(trigger=str(next_trigger or ""), actions=actions)

    db.commit()
    db.refresh(automation)
    return automation


def delete_automation(db: Session, *, automation: Automation) -> None:
    db.delete(automation)
    db.commit()
