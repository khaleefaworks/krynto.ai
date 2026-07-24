from __future__ import annotations

import json

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_tag import ConversationTag
from app.models.message import Message
from app.models.website import Website
from app.models.website_form_submission import WebsiteFormSubmission


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


def _message_counts_and_last_message(db: Session, conversation_ids: list[int]) -> dict[int, dict]:
    """Message count + last message for exactly these conversations.

    Scoped via `IN (conversation_ids)` — the GROUP BY and the ROW_NUMBER()
    window function below only ever touch messages belonging to this
    specific set (a chat-list page, typically ~50 conversations), never the
    whole messages table. Shared by both the active and resolved chat list
    queries, which previously each ran the unscoped version of this same
    join independently.
    """
    if not conversation_ids:
        return {}

    counts = dict(
        db.query(Message.conversation_id, sa.func.count(Message.id))
        .filter(Message.conversation_id.in_(conversation_ids))
        .group_by(Message.conversation_id)
        .all()
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
        .filter(Message.conversation_id.in_(conversation_ids))
        .subquery()
    )
    last_rows = (
        db.query(msg_ranked.c.conversation_id, msg_ranked.c.content, msg_ranked.c.event_type, msg_ranked.c.created_at)
        .filter(msg_ranked.c.rn == 1)
        .all()
    )

    result: dict[int, dict] = {
        cid: {"count": counts.get(cid, 0), "content": None, "event_type": None, "created_at": None}
        for cid in conversation_ids
    }
    for cid, content, event_type, created_at in last_rows:
        result[cid]["content"] = content
        result[cid]["event_type"] = event_type
        result[cid]["created_at"] = created_at
    return result


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


def update_visitor_contact_fields(
    conversation: Conversation,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
) -> bool:
    """Overwrite visitor_name/email/phone with any newly-provided non-empty
    values. Deliberately last-write-wins (not "only if empty") — a visitor
    correcting a typo they just sent must be able to replace what's already
    on the conversation. Callers still need to db.commit(); returns whether
    anything changed so they know whether a commit/re-enqueue is needed.
    """
    changed = False
    if name and conversation.visitor_name != str(name):
        conversation.visitor_name = str(name)
        changed = True
    if email and conversation.visitor_email != str(email):
        conversation.visitor_email = str(email)
        changed = True
    if phone and conversation.visitor_phone != str(phone):
        conversation.visitor_phone = str(phone)
        changed = True
    return changed


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
    """Return rows of (Conversation, website_name, message_count, last_message, last_message_at).

    Same fix as resolved_conversations_with_counts_and_last_message below:
    resolve the filtered Conversation set first (no messages join), then
    look up message count / last message scoped to just those ids — rather
    than the previous unscoped GROUP BY + ROW_NUMBER() over every message
    in the whole system on every request.
    """

    rows_query = (
        db.query(Conversation, Website.name.label("website_name"))
        .outerjoin(Website, Website.id == Conversation.website_id)
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

    page = rows_query.all()
    if not page:
        return []

    info = _message_counts_and_last_message(db, [conv.id for conv, _ in page])

    return [
        (
            conv,
            website_name,
            info[conv.id]["count"],
            _unwrap_last_message(info[conv.id]["content"], info[conv.id]["event_type"]),
            info[conv.id]["created_at"],
        )
        for conv, website_name in page
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
    """Return rows of (Conversation, website_name, message_count, last_message, last_message_at).

    Message count / last message used to be computed by joining a GROUP BY
    and a ROW_NUMBER() window function over the ENTIRE messages table on
    every request, before pagination was applied — with resolved history
    growing unboundedly (20k+ conversations, 30k+ messages at time of
    writing) that got slower every day regardless of the 50-row page
    actually being shown. Now the filtered/sorted/paginated Conversation
    page is resolved first (cheap — no messages join at all except the
    narrow `search` EXISTS-style filters below), and the two subqueries
    only ever aggregate over that page's own conversation ids.
    """

    rows_query = (
        db.query(Conversation, Website.name.label("website_name"))
        .outerjoin(Website, Website.id == Conversation.website_id)
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
                # Matches values from any submitted form, not just the
                # contact card (e.g. a "Virtual Office" form's business_name) —
                # those never land on Conversation.visitor_* since only the
                # contact-card form mirrors onto those columns.
                Conversation.id.in_(
                    db.query(WebsiteFormSubmission.conversation_id).filter(
                        WebsiteFormSubmission.conversation_id.isnot(None),
                        sa.func.lower(sa.cast(WebsiteFormSubmission.data, sa.Text)).like(q),
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

    page = rows_query.offset(offset).limit(limit).all()
    if not page:
        return []

    info = _message_counts_and_last_message(db, [conv.id for conv, _ in page])

    return [
        (
            conv,
            website_name,
            info[conv.id]["count"],
            _unwrap_last_message(info[conv.id]["content"], info[conv.id]["event_type"]),
            info[conv.id]["created_at"],
        )
        for conv, website_name in page
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
                Conversation.id.in_(
                    db.query(WebsiteFormSubmission.conversation_id).filter(
                        WebsiteFormSubmission.conversation_id.isnot(None),
                        sa.func.lower(sa.cast(WebsiteFormSubmission.data, sa.Text)).like(s),
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
