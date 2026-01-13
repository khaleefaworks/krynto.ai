from __future__ import annotations

from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.conversation_read import ConversationRead
from app.models.message import Message, MessageSenderType


def mark_conversation_read(
    db: Session,
    *,
    conversation_id: int,
    user_id: int,
    read_at: datetime | None = None,
) -> ConversationRead:
    """Upsert a conversation read marker for a user."""

    if read_at is None:
        read_at = datetime.now(timezone.utc)

    existing = (
        db.query(ConversationRead)
        .filter(
            ConversationRead.conversation_id == conversation_id,
            ConversationRead.user_id == user_id,
        )
        .first()
    )

    if existing:
        existing.last_read_at = read_at
        db.add(existing)
        return existing

    row = ConversationRead(
        conversation_id=conversation_id,
        user_id=user_id,
        last_read_at=read_at,
    )
    db.add(row)
    return row


def unread_counts_for_conversation_ids(
    db: Session,
    *,
    user_id: int,
    conversation_ids: list[int],
) -> dict[int, int]:
    """Return unread visitor-message counts per conversation for a user.

    Unread definition: visitor messages created after the user's last_read_at.
    If the user never read the conversation, all visitor messages are unread.
    """

    if not conversation_ids:
        return {}

    last_read_subq = (
        db.query(
            ConversationRead.conversation_id.label("conversation_id"),
            sa.func.max(ConversationRead.last_read_at).label("last_read_at"),
        )
        .filter(ConversationRead.user_id == user_id)
        .group_by(ConversationRead.conversation_id)
        .subquery()
    )

    rows = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            sa.func.count(Message.id).label("unread_count"),
        )
        .outerjoin(
            last_read_subq,
            last_read_subq.c.conversation_id == Message.conversation_id,
        )
        .filter(Message.conversation_id.in_(conversation_ids))
        .filter(Message.sender_type == MessageSenderType.VISITOR)
        .filter(
            sa.or_(
                last_read_subq.c.last_read_at.is_(None),
                Message.created_at > last_read_subq.c.last_read_at,
            )
        )
        .group_by(Message.conversation_id)
        .all()
    )

    counts: dict[int, int] = {int(cid): 0 for cid in conversation_ids}
    for conversation_id, unread_count in rows:
        counts[int(conversation_id)] = int(unread_count or 0)
    return counts
