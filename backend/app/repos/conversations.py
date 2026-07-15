from __future__ import annotations

import json

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_tag import ConversationTag
from app.models.message import Message
from app.models.website import Website


def _unwrap_last_message(content: str | None, event_type: str | None) -> str | None:
    """Undo bot_prompt_buttons' enriched-JSON storage for list previews.

    Message.content for a bot_prompt_buttons row is the raw JSON blob (message
    + buttons + automation_id) that the widget needs to resume a sub-menu.
    serialize_message() already unwraps this for the thread view; this list
    preview goes through a separate raw SQL subquery that never called it —
    so a conversation whose latest message was a bot prompt showed the raw
    JSON as its "last message" instead of the human-readable text.
    """
    if event_type != "bot_prompt_buttons" or not content:
        return content
    try:
        parsed = json.loads(content)
    except (ValueError, TypeError):
        return content
    if isinstance(parsed, dict) and "message" in parsed:
        return parsed["message"]
    return content


def get_conversation_by_id(db: Session, conversation_id: int) -> Conversation | None:
    return db.query(Conversation).filter_by(id=conversation_id).first()


def get_conversation_by_short_id(db: Session, short_id: str) -> Conversation | None:
    return db.query(Conversation).filter_by(short_id=short_id).first()


def get_open_conversation_by_session(db: Session, *, website_id: int, session_id: str) -> Conversation | None:
    """Return the most-recent OPEN non-visitor-ended conversation for this session.

    There is no inactivity cutoff: once a conversation is OPEN it stays resumable
    until an agent or visitor explicitly resolves / ends it.  The partial unique
    index on (website_id, session_id) WHERE status='open' guarantees at most one
    row matches, making the ORDER BY / LIMIT 1 a safety net only.
    """
    return (
        db.query(Conversation)
        .filter(
            Conversation.session_id == session_id,
            Conversation.website_id == website_id,
            Conversation.status == ConversationStatus.OPEN,
            Conversation.visitor_ended == False,  # noqa: E712
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
    organization_id: int | None = None,
    bot_only: bool | None = None,
    exclude_bot_only: bool | None = None,
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
            Message.event_type.label("event_type"),
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
        db.query(msg_ranked.c.conversation_id, msg_ranked.c.content, msg_ranked.c.event_type, msg_ranked.c.created_at)
        .filter(msg_ranked.c.rn == 1)
        .subquery()
    )

    rows_query = (
        db.query(
            Conversation,
            Website.name.label("website_name"),
            sa.func.coalesce(msg_count_subq.c.message_count, 0).label("message_count"),
            last_msg_subq.c.content.label("last_message"),
            last_msg_subq.c.event_type.label("last_message_event_type"),
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

    if organization_id is not None:
        rows_query = rows_query.filter(Website.organization_id == organization_id)

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
            # Strict team filter: team-scoped users only see their teams' conversations.
            # Unrouted conversations (team_id IS NULL) are NOT shown — they become
            # visible once the routing bot assigns a team (visitor clicks a button).
            rows_query = rows_query.filter(Conversation.team_id.in_(team_ids_norm))

    if bot_only is True:
        rows_query = rows_query.filter(Conversation.bot_only == True)  # noqa: E712
    elif exclude_bot_only is True:
        rows_query = rows_query.filter(
            sa.or_(Conversation.bot_only == False, Conversation.bot_only.is_(None))  # noqa: E712
        )

    try:
        rows_query = rows_query.order_by(Conversation.updated_at.desc())
    except Exception:
        rows_query = rows_query.order_by(Conversation.created_at.desc())

    return [
        (conv, website_name, message_count, _unwrap_last_message(last_message, last_message_event_type), last_message_at)
        for conv, website_name, message_count, last_message, last_message_event_type, last_message_at in rows_query.all()
    ]


def resolved_conversations_with_counts_and_last_message(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    team_ids: list[int] | None = None,
    organization_id: int | None = None,
    agent_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    filter_team_id: int | None = None,
    filter_tag_ids: list[int] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
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
            Message.event_type.label("event_type"),
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
        db.query(msg_ranked.c.conversation_id, msg_ranked.c.content, msg_ranked.c.event_type, msg_ranked.c.created_at)
        .filter(msg_ranked.c.rn == 1)
        .subquery()
    )

    rows_query = (
        db.query(
            Conversation,
            Website.name.label("website_name"),
            sa.func.coalesce(msg_count_subq.c.message_count, 0).label("message_count"),
            last_msg_subq.c.content.label("last_message"),
            last_msg_subq.c.event_type.label("last_message_event_type"),
            last_msg_subq.c.created_at.label("last_message_at"),
        )
        .outerjoin(Website, Website.id == Conversation.website_id)
        .outerjoin(msg_count_subq, msg_count_subq.c.conversation_id == Conversation.id)
        .outerjoin(last_msg_subq, last_msg_subq.c.conversation_id == Conversation.id)
        .filter(Conversation.status == ConversationStatus.RESOLVED)
        # Exclude bot/welcome-only conversations (same rule as the active list).
        .filter(
            sa.or_(
                Conversation.last_visitor_message_at.isnot(None),
                Conversation.last_agent_message_at.isnot(None),
                Conversation.assigned_agent_id.isnot(None),
            )
        )
    )

    if organization_id is not None:
        rows_query = rows_query.filter(Website.organization_id == organization_id)

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

    if search:
        q = f"%{search.lower()}%"
        rows_query = rows_query.filter(
            sa.or_(
                sa.func.lower(Conversation.visitor_name).like(q),
                sa.func.lower(Conversation.visitor_email).like(q),
                sa.func.lower(Conversation.visitor_phone).like(q),
                sa.func.lower(Conversation.short_id).like(q),
                Conversation.id.in_(
                    db.query(Message.conversation_id).filter(
                        sa.func.lower(Message.content).like(q)
                    )
                ),
            )
        )

    if filter_team_id is not None:
        rows_query = rows_query.filter(Conversation.team_id == filter_team_id)

    if filter_tag_ids:
        for tag_id in filter_tag_ids:
            rows_query = rows_query.filter(
                Conversation.id.in_(
                    db.query(ConversationTag.conversation_id).filter(ConversationTag.tag_id == tag_id)
                )
            )

    if date_from:
        rows_query = rows_query.filter(Conversation.created_at >= date_from)

    if date_to:
        rows_query = rows_query.filter(Conversation.created_at <= date_to)

    try:
        rows_query = rows_query.order_by(Conversation.updated_at.desc())
    except Exception:
        rows_query = rows_query.order_by(Conversation.created_at.desc())

    return [
        (conv, website_name, message_count, _unwrap_last_message(last_message, last_message_event_type), last_message_at)
        for conv, website_name, message_count, last_message, last_message_event_type, last_message_at
        in rows_query.offset(offset).limit(limit).all()
    ]


def resolved_conversations_count(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    team_ids: list[int] | None = None,
    organization_id: int | None = None,
    agent_id: int | None = None,
    search: str | None = None,
    filter_team_id: int | None = None,
    filter_tag_ids: list[int] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> int:
    """Return the total count of resolved conversations matching the given filters."""
    q = (
        db.query(sa.func.count(Conversation.id))
        .outerjoin(Website, Website.id == Conversation.website_id)
        .filter(Conversation.status == ConversationStatus.RESOLVED)
        .filter(
            sa.or_(
                Conversation.last_visitor_message_at.isnot(None),
                Conversation.last_agent_message_at.isnot(None),
                Conversation.assigned_agent_id.isnot(None),
            )
        )
    )

    if organization_id is not None:
        q = q.filter(Website.organization_id == organization_id)

    if website_id:
        q = q.filter(Conversation.website_id == website_id)

    if website_ids is not None:
        website_ids_norm = [int(w) for w in website_ids]
        if not website_ids_norm:
            return 0
        q = q.filter(Conversation.website_id.in_(website_ids_norm))

    if team_ids is not None:
        team_ids_norm = [int(t) for t in team_ids]
        if not team_ids_norm:
            return 0
        q = q.filter(Conversation.team_id.in_(team_ids_norm))

    if agent_id:
        q = q.filter(Conversation.assigned_agent_id == agent_id)

    if search:
        s = f"%{search.lower()}%"
        q = q.filter(
            sa.or_(
                sa.func.lower(Conversation.visitor_name).like(s),
                sa.func.lower(Conversation.visitor_email).like(s),
                sa.func.lower(Conversation.visitor_phone).like(s),
                sa.func.lower(Conversation.short_id).like(s),
                Conversation.id.in_(
                    db.query(Message.conversation_id).filter(
                        sa.func.lower(Message.content).like(s)
                    )
                ),
            )
        )

    if filter_team_id is not None:
        q = q.filter(Conversation.team_id == filter_team_id)

    if filter_tag_ids:
        for tag_id in filter_tag_ids:
            q = q.filter(
                Conversation.id.in_(
                    db.query(ConversationTag.conversation_id).filter(ConversationTag.tag_id == tag_id)
                )
            )

    if date_from:
        q = q.filter(Conversation.created_at >= date_from)

    if date_to:
        q = q.filter(Conversation.created_at <= date_to)

    return q.scalar() or 0
