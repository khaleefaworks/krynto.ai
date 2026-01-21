from __future__ import annotations

from datetime import timezone
from typing import Any, Optional, Tuple, Dict


def resolve_sender_user(db, sender: str | None):
    if not sender:
        return None

    # Newer messages may store user_id as a string in sender.
    try:
        user_id = int(str(sender))
        from app.models.user import User

        return db.query(User).filter(User.id == user_id).first()
    except Exception:
        pass

    # Backwards-compat: older messages might store agent email.
    try:
        from app.models.user import User

        return db.query(User).filter(User.email == str(sender)).first()
    except Exception:
        return None


def message_presentation(
    db,
    msg: Any,
) -> Tuple[str | None, Any, Optional[str], Optional[str]]:
    """Compute sender presentation fields shared by REST + WS.

    Returns: (sender_type, event_type, sender_name, sender_avatar_url)
    """

    sender_type = (
        msg.sender_type.value
        if hasattr(getattr(msg, "sender_type", None), "value")
        else getattr(msg, "sender_type", None)
    )
    event_type = getattr(msg, "event_type", None)

    sender_name: Optional[str] = None
    sender_avatar_url: Optional[str] = None

    if sender_type == "agent":
        u = resolve_sender_user(db, getattr(msg, "sender", None))
        if u:
            sender_name = u.name or u.email
            sender_avatar_url = getattr(u, "avatar_url", None)
    elif sender_type == "system":
        # Bot/automation messages should render with a robot avatar client-side.
        sender = getattr(msg, "sender", None)
        if sender == "bot" or event_type == "bot" or (
            event_type and str(event_type).startswith("automation")
        ):
            sender_name = "AI"

    return sender_type, event_type, sender_name, sender_avatar_url


def serialize_message(db, msg: Any) -> Dict[str, Any]:
    """Canonical message DTO shared by REST + WS.

    Intentionally includes backward-compatible keys (e.g. `sender`) while also
    providing canonical fields (`sender_type`, `event_type`).
    """

    sender_type, event_type, sender_name, sender_avatar_url = message_presentation(
        db, msg
    )

    created_at = getattr(msg, "created_at", None)
    try:
        # Some DB/driver combinations can yield a naive datetime even when the column
        # is intended to be timezone-aware. A naive ISO string is interpreted by
        # browsers as *local time*, which can display shifted chat timestamps.
        if created_at is not None and getattr(created_at, "tzinfo", None) is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        created_at_iso = created_at.isoformat() if created_at else None
    except Exception:
        created_at_iso = None

    return {
        "id": getattr(msg, "id", None),
        "conversation_id": getattr(msg, "conversation_id", None),
        "sender": getattr(msg, "sender", None),
        "sender_type": sender_type,
        "event_type": event_type,
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
        "content": getattr(msg, "content", None),
        "created_at": created_at_iso,
    }
