from __future__ import annotations

import sqlalchemy as sa
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message
from app.models.website import Website

# After this many hours of inactivity the visitor gets a fresh conversation instead
# of resuming the old thread.
CONVERSATION_RESUME_CUTOFF_HOURS = 24


def get_conversation_by_id(db: Session, conversation_id: int) -> Conversation | None:
    return db.query(Conversation).filter_by(id=conversation_id).first()


def get_conversation_by_short_id(db: Session, short_id: str) -> Conversation | None:
    return db.query(Conversation).filter_by(short_id=short_id).first()


def get_open_conversation_by_session(db: Session, *, website_id: int, session_id: str) -> Conversation | None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=CONVERSATION_RESUME_CUTOFF_HOURS)
    return (
        db.query(Conversation)
        .filter(
            Conversation.session_id == session_id,
            Conversation.website_id == website_id,
            Conversation.status == ConversationStatus.OPEN,
            Conversation.visitor_ended == False,  # noqa: E712
            Conversation.updated_at > cutoff,
        )
        .order_by(Conversation.id.desc())
        .first()
    )


def get_conversation_by_session(db: Session, *, website_id: int, session_id: str) -> Conversation | None:
    open_conversation = get_open_conversation_by_session(
        db,
        website_id=website_id,
        session_id=session_id,
    )
    if open_conversation:
        return open_conversation

    return (
        db.query(Conversation)
        .filter_by(session_id=session_id, website_id=website_id)
        .order_by(Conversation.id.desc())
        .first()
    )


def active_conversations_with_counts_and_last_message(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    team_ids: list[int] | None = None,
):
    """Return rows of (Conversation, website_name, message_count, last_message, last_message_at)."""

    msg_count_subq = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            sa.func.count(Message.id).label("message_count"),
        )
        .group_by(Message.conversation_id)
        .subquery()
    )

    msg_ranked = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            Message.content.label("content"),
            Message.created_at.label("created_at"),
            sa.func.row_number()
            .over(
                partition_by=Message.conversation_id,
                order_by=(Message.created_at.desc(), Message.id.desc()),
            )
            .label("rn"),
        )
        .subquery()
    )

    last_msg_subq = (
        db.query(msg_ranked.c.conversation_id, msg_ranked.c.content, msg_ranked.c.created_at)
        .filter(msg_ranked.c.rn == 1)
        .subquery()
    )

    rows_query = (
        db.query(
            Conversation,
            Website.name.label("website_name"),
            sa.func.coalesce(msg_count_subq.c.message_count, 0).label("message_count"),
            last_msg_subq.c.content.label("last_message"),
            last_msg_subq.c.created_at.label("last_message_at"),
        )
        .outerjoin(Website, Website.id == Conversation.website_id)
        .outerjoin(msg_count_subq, msg_count_subq.c.conversation_id == Conversation.id)
        .outerjoin(last_msg_subq, last_msg_subq.c.conversation_id == Conversation.id)
        .filter(Conversation.status == ConversationStatus.OPEN)
        # Do not show "empty" conversations (e.g. welcome-only) in the agent inbox.
        # A conversation is considered "active" when:
        #   - the visitor has sent at least one message, OR
        #   - an agent has sent a message, OR
        #   - an agent has joined/been assigned to it
        .filter(
            sa.or_(
                Conversation.last_visitor_message_at.isnot(None),
                Conversation.last_agent_message_at.isnot(None),
                Conversation.assigned_agent_id.isnot(None),
            )
        )
    )

    if website_id:
        rows_query = rows_query.filter(Conversation.website_id == website_id)

    if website_ids is not None:
        website_ids_norm = [int(w) for w in website_ids]
        if not website_ids_norm:
            return []
        rows_query = rows_query.filter(Conversation.website_id.in_(website_ids_norm))

    if team_ids is not None:
        team_ids_norm = [int(t) for t in team_ids]
        if not team_ids_norm:
            rows_query = rows_query.filter(sa.literal(False))
        else:
            # Include conversations assigned to the agent's teams AND conversations
            # not yet assigned to any team (team_id IS NULL) — those are claimable
            # by anyone on the website.
            rows_query = rows_query.filter(
                sa.or_(
                    Conversation.team_id.in_(team_ids_norm),
                    Conversation.team_id.is_(None),
                )
            )

    try:
        rows_query = rows_query.order_by(Conversation.updated_at.desc())
    except Exception:
        rows_query = rows_query.order_by(Conversation.created_at.desc())

    return rows_query.all()


def resolved_conversations_with_counts_and_last_message(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    team_ids: list[int] | None = None,
    agent_id: int | None = None,
    limit: int = 50,
):
    """Return rows of (Conversation, website_name, message_count, last_message, last_message_at)."""

    msg_count_subq = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            sa.func.count(Message.id).label("message_count"),
        )
        .group_by(Message.conversation_id)
        .subquery()
    )

    msg_ranked = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            Message.content.label("content"),
            Message.created_at.label("created_at"),
            sa.func.row_number()
            .over(
                partition_by=Message.conversation_id,
                order_by=(Message.created_at.desc(), Message.id.desc()),
            )
            .label("rn"),
        )
        .subquery()
    )

    last_msg_subq = (
        db.query(msg_ranked.c.conversation_id, msg_ranked.c.content, msg_ranked.c.created_at)
        .filter(msg_ranked.c.rn == 1)
        .subquery()
    )

    rows_query = (
        db.query(
            Conversation,
            Website.name.label("website_name"),
            sa.func.coalesce(msg_count_subq.c.message_count, 0).label("message_count"),
            last_msg_subq.c.content.label("last_message"),
            last_msg_subq.c.created_at.label("last_message_at"),
        )
        .outerjoin(Website, Website.id == Conversation.website_id)
        .outerjoin(msg_count_subq, msg_count_subq.c.conversation_id == Conversation.id)
        .outerjoin(last_msg_subq, last_msg_subq.c.conversation_id == Conversation.id)
        .filter(Conversation.status == ConversationStatus.RESOLVED)
    )

    if website_id:
        rows_query = rows_query.filter(Conversation.website_id == website_id)

    if website_ids is not None:
        website_ids_norm = [int(w) for w in website_ids]
        if not website_ids_norm:
            return []
        rows_query = rows_query.filter(Conversation.website_id.in_(website_ids_norm))

    if team_ids is not None:
        team_ids_norm = [int(t) for t in team_ids]
        if not team_ids_norm:
            rows_query = rows_query.filter(sa.literal(False))
        else:
            rows_query = rows_query.filter(Conversation.team_id.in_(team_ids_norm))

    if agent_id:
        rows_query = rows_query.filter(Conversation.assigned_agent_id == agent_id)

    try:
        rows_query = rows_query.order_by(Conversation.updated_at.desc())
    except Exception:
        rows_query = rows_query.order_by(Conversation.created_at.desc())

    return rows_query.limit(limit).all()
