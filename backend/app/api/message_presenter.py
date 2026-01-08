from __future__ import annotations

from typing import Any, Optional, Tuple


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
        msg.sender_type.value if hasattr(getattr(msg, "sender_type", None), "value") else getattr(msg, "sender_type", None)
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
