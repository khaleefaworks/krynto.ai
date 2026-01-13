from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.message import Message


def get_message_by_id(db: Session, message_id: int) -> Message | None:
    return db.query(Message).filter_by(id=message_id).first()


def list_messages_for_conversation(db: Session, conversation_id: int):
    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .order_by(Message.created_at)
        .all()
    )


def get_last_welcome_message(db: Session, conversation_id: int) -> Message | None:
    return (
        db.query(Message)
        .filter_by(conversation_id=conversation_id)
        .filter(Message.event_type == "automation_welcome")
        .order_by(Message.created_at.desc())
        .first()
    )
