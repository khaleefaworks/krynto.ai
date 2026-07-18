from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple, Dict

# CC1: fixed backstop so a contact card doesn't stay fillable forever in a
# conversation nobody ever resolves. ponytail: hardcoded, make per-website
# configurable if a tenant ever asks for a different window.
CONTACT_CARD_TTL_HOURS = 24


def contact_card_state(db, msg: Any) -> Dict[str, Any]:
    """Single source of truth for whether an agent-sent contact-card message
    is still fillable — used by both the widget's history load and the agent
    dashboard's, and by submit_form's own enforcement, so the display and the
    actual accept/reject decision can never drift apart.

    A card is "expired" once a newer contact-card message exists in the same
    conversation (sending a new one supersedes the old — the only way to get
    a fillable card again), the conversation is resolved, or it's older than
    CONTACT_CARD_TTL_HOURS. Otherwise "pending", or "filled" if a submission
    already exists for this exact message.
    """
    from app.models.website_form_submission import WebsiteFormSubmission
    from app.models.message import Message
    from app.models.conversation import Conversation, ConversationStatus

    msg_id = getattr(msg, "id", None)
    conversation_id = getattr(msg, "conversation_id", None)

    submission = (
        db.query(WebsiteFormSubmission)
        .filter(WebsiteFormSubmission.message_id == msg_id)
        .first()
    )
    if submission:
        return {"status": "filled", "data": submission.data}

    newer_exists = (
        db.query(Message.id)
        .filter(
            Message.conversation_id == conversation_id,
            Message.event_type == "contact_card",
            Message.id > msg_id,
        )
        .first()
        is not None
    )
    if newer_exists:
        return {"status": "expired", "reason": "superseded"}

    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conversation is not None and conversation.status == ConversationStatus.RESOLVED:
        return {"status": "expired", "reason": "resolved"}

    created_at = getattr(msg, "created_at", None)
    if created_at is not None:
        aware = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - aware > timedelta(hours=CONTACT_CARD_TTL_HOURS):
            return {"status": "expired", "reason": "ttl"}

    return {"status": "pending"}


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


def resolve_actor_kind(
    *, sender_type: Optional[str], sender: Optional[str], event_type: Optional[str]
) -> Tuple[str, str]:
    """Derive actor/kind with backward compatibility.

    actor: visitor | agent | bot | ai | system
    kind: chat | event
    """

    normalized_sender_type = (sender_type or "").lower().strip()
    normalized_sender = (sender or "").lower().strip()
    normalized_event = (event_type or "").lower().strip()

    if normalized_sender_type == "visitor":
        return "visitor", "chat"

    if normalized_sender_type == "agent":
        return "agent", "chat"

    if normalized_sender_type == "system":
        # Bot-like system messages are treated as chat messages authored by bot.
        if normalized_sender == "bot" or normalized_event == "bot" or normalized_event.startswith("automation"):
            return "bot", "chat"
        # Default system events are timeline items.
        return "system", "event"

    # Fallback: treat as system event
    return "system", "event"


def serialize_message(db, msg: Any) -> Dict[str, Any]:
    """Canonical message DTO shared by REST + WS.

    Intentionally includes backward-compatible keys (e.g. `sender`) while also
    providing canonical fields (`sender_type`, `event_type`).
    """

    sender_type, event_type, sender_name, sender_avatar_url = message_presentation(
        db, msg
    )

    actor, kind = resolve_actor_kind(
        sender_type=sender_type,
        sender=getattr(msg, "sender", None),
        event_type=event_type,
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

    # For bot_prompt_buttons, the DB content is enriched JSON with buttons metadata.
    # Extract just the human-readable message for display, but preserve the raw
    # content so the widget can re-parse buttons from history on page reload.
    raw_content = getattr(msg, "content", None)
    display_content = raw_content
    if event_type in ("bot_prompt_buttons", "contact_card") and raw_content:
        try:
            import json as _json
            parsed = _json.loads(raw_content)
            if isinstance(parsed, dict) and "message" in parsed:
                display_content = parsed["message"]
        except (ValueError, TypeError):
            pass

    result = {
        "id": getattr(msg, "id", None),
        "conversation_id": getattr(msg, "conversation_id", None),
        "sender": getattr(msg, "sender", None),
        "sender_type": sender_type,
        "event_type": event_type,
        "actor": actor,
        "kind": kind,
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
        "content": display_content,
        "created_at": created_at_iso,
    }

    # Include raw enriched JSON for bot_prompt_buttons/contact_card so the widget
    # can re-parse them when rendering history on page reload/navigation.
    if event_type in ("bot_prompt_buttons", "contact_card") and raw_content and raw_content != display_content:
        result["raw_content"] = raw_content

    if event_type == "contact_card":
        result["contact_card_state"] = contact_card_state(db, msg)

    if event_type == "conversation_resolved":
        try:
            from app.models.conversation import Conversation

            conversation = (
                db.query(Conversation)
                .filter(Conversation.id == getattr(msg, "conversation_id", None))
                .first()
            )
            if conversation is not None:
                result["closed_by"] = getattr(conversation, "closed_by", None)
        except Exception:
            pass

    return result
