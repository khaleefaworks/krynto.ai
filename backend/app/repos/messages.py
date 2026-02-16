from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.message import Message
from app.models.message import MessageSenderType


def get_message_by_id(db: Session, message_id: int) -> Message | None:
    return db.query(Message).filter_by(id=message_id).first()


def list_messages_for_conversation(db: Session, conversation_id: int):
    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .order_by(Message.id)
        .all()
    )


def get_last_welcome_message(db: Session, conversation_id: int) -> Message | None:
    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .filter(Message.event_type == "automation_welcome")
        .order_by(Message.id.desc())
        .first()
    )


def get_last_event_message(db: Session, conversation_id: int, event_type: str) -> Message | None:
    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .filter(Message.event_type == event_type)
        .order_by(Message.id.desc())
        .first()
    )


def get_last_human_message(db: Session, conversation_id: int) -> Message | None:
    """Return the latest visitor/agent chat message for a conversation."""

    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .filter(Message.sender_type.in_([MessageSenderType.VISITOR, MessageSenderType.AGENT]))
        .order_by(Message.id.desc())
        .first()
    )
