"""Analytics / Statistics API.

Provides Smartsupp-style statistics adapted for multi-website:
  - Conversation stats (new, replied, resolved, avg response time)
  - Agent stats (summary + per-agent breakdown)
  - Tag stats (usage counts)

All endpoints accept ``website_id`` (optional — omit for global) and a
``start``/``end`` date-range (ISO-8601 date strings, inclusive).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, List, Optional
from urllib.parse import urlparse, parse_qs

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, case, and_, distinct
from sqlalchemy.orm import Session
from fastapi.responses import StreamingResponse
import io
from openpyxl import Workbook
from sqlalchemy.orm import aliased

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.models.conversation_tag import ConversationTag
from app.models.conversation_rating import ConversationRating
from app.models.tag import Tag
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.website_team import WebsiteTeam, WebsiteTeamMember
from app.models.conversation_page_view import ConversationPageView
from app.api.deps import get_current_user
from app.services.visibility import compute_visibility_scope

logger = get_logger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _allowed_website_ids(
    db: Session,
    *,
    current_user: User,
    requested_website_id: int | None,
) -> list[int] | None:
    """Return the list of website IDs the user is allowed to query for analytics.

    Returns None when unrestricted (SYSTEM_MANAGER with no explicit website filter).
    Returns an empty list when the user has no accessible websites.
    Returns a list with one item when a specific website_id was requested (after org check).
    """
    scope = compute_visibility_scope(db, user=current_user)

    if requested_website_id is not None:
        # Verify the requested website belongs to the user's org.
        if scope.organization_id is not None:
            w = db.query(Website.id).filter_by(
                id=requested_website_id, organization_id=scope.organization_id
            ).first()
            if not w:
                return []  # No accessible websites → empty results
        return [requested_website_id]

    # No specific website requested → use org scope.
    if scope.organization_id is None:
        return None  # SYSTEM_MANAGER: unrestricted

    # AGENT: restrict to websites where the agent is a team member.
    # If the agent has no team memberships yet, fall back to full org scope
    # (same as MANAGER/OWNER) — unassigned agents can still receive chats.
    if current_user.role == UserRole.AGENT:
        rows = (
            db.query(WebsiteTeam.website_id)
            .join(WebsiteTeamMember, WebsiteTeamMember.team_id == WebsiteTeam.id)
            .filter(WebsiteTeamMember.user_id == current_user.id)
            .distinct()
            .all()
        )
        if rows:
            return [r[0] for r in rows]
        # No team memberships → fall through to org-wide scope below

    rows = db.query(Website.id).filter_by(organization_id=scope.organization_id).all()
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_range(
    start: date | None,
    end: date | None,
    default_days: int = 30,
) -> tuple[datetime, datetime]:
    """Return a (start_dt, end_dt) pair in UTC from date strings."""
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=default_days - 1)
    start_dt = datetime.combine(start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(end, time.max, tzinfo=timezone.utc)
    return start_dt, end_dt


def _date_series(start_dt: datetime, end_dt: datetime) -> list[str]:
    """Return a list of date strings (YYYY-MM-DD) between start and end inclusive."""
    dates: list[str] = []
    current = start_dt.date()
    end_date = end_dt.date()
    while current <= end_date:
        dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


def _fill_series(data: dict[str, int | float], series: list[str], default: int | float = 0) -> list[dict]:
    """Convert a sparse {date: value} dict into a dense list aligned with series."""
    return [{"date": d, "value": data.get(d, default)} for d in series]


def _bot_filter(bot_only: bool | None):
    """Return the SQLAlchemy bot_only column filter clause.

    bot_only=True  → show ONLY automated conversations
    bot_only=None/False → exclude automated conversations (default)
    """
    if bot_only is True:
        return Conversation.bot_only == True   # noqa: E712
    return Conversation.bot_only == False      # noqa: E712


# ---------------------------------------------------------------------------
# 1. Conversation Statistics
# ---------------------------------------------------------------------------

@router.get("/conversations/summary")
def conversation_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    bot_only: Optional[bool] = Query(None),
):
    """High-level conversation KPIs for the selected period."""
    start_dt, end_dt = _date_range(start, end)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    if allowed_ids is not None and not allowed_ids:
        return {
            "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
            "total_new": 0, "total_replied": 0, "total_resolved": 0,
            "avg_first_response_seconds": None,
        }

    # Shared scope filters (website + team) — each metric adds its own date field.
    base = db.query(Conversation)
    if allowed_ids is not None:
        base = base.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        base = base.filter(Conversation.team_id == team_id)

    # New: counted on the day the visitor first interacted (last_visitor_message_at).
    total_new = base.filter(
        Conversation.last_visitor_message_at.isnot(None),
        Conversation.last_visitor_message_at >= start_dt,
        Conversation.last_visitor_message_at <= end_dt,
        _bot_filter(bot_only),
    ).count()

    # Resolved: counted on the day the conversation was closed (resolved_at).
    _resolved_closed_by = (
        Conversation.closed_by == 'bot'
        if bot_only is True
        else Conversation.closed_by.notin_(['inactivity', 'system_auto', 'bot'])
    )
    total_resolved = base.filter(
        Conversation.status == ConversationStatus.RESOLVED,
        Conversation.last_visitor_message_at.isnot(None),
        _resolved_closed_by,
        _bot_filter(bot_only),
        Conversation.resolved_at.isnot(None),
        Conversation.resolved_at >= start_dt,
        Conversation.resolved_at <= end_dt,
    ).count()

    # Replied = conversations (created in period) with at least one agent message.
    replied_subq = (
        db.query(Message.conversation_id)
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .distinct()
        .subquery()
    )
    total_replied = base.filter(
        Conversation.created_at >= start_dt,
        Conversation.created_at <= end_dt,
        Conversation.id.in_(db.query(replied_subq.c.conversation_id))
    ).count()

    # Avg first response time (seconds) — time from conversation.created_at
    # to the first agent message in that conversation.
    first_agent_msg = (
        db.query(
            Message.conversation_id,
            func.min(Message.created_at).label("first_agent_at"),
        )
        .filter(
            Message.sender_type == MessageSenderType.AGENT,
        )
        .group_by(Message.conversation_id)
        .subquery()
    )

    response_rows = (
        db.query(
            func.avg(
                func.extract("epoch", first_agent_msg.c.first_agent_at)
                - func.extract("epoch", Conversation.created_at)
            )
        )
        .join(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
    )
    if allowed_ids is not None:
        if allowed_ids:
            response_rows = response_rows.filter(Conversation.website_id.in_(allowed_ids))
        else:
            avg_response_seconds = None
            response_rows = None

    avg_response_seconds = response_rows.scalar() if response_rows is not None else None

    return {
        "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
        "total_new": total_new,
        "total_replied": total_replied,
        "total_resolved": total_resolved,
        "avg_first_response_seconds": round(avg_response_seconds, 1) if avg_response_seconds else None,
    }


@router.get("/conversations/new")
def new_conversations_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    bot_only: Optional[bool] = Query(None),
):
    """Daily new conversation counts."""
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series)}

    # Group by visitor's first-interaction date (last_visitor_message_at).
    q = (
        db.query(
            func.date(Conversation.last_visitor_message_at).label("day"),
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.last_visitor_message_at.isnot(None),
            Conversation.last_visitor_message_at >= start_dt,
            Conversation.last_visitor_message_at <= end_dt,
            _bot_filter(bot_only),
        )
        .group_by(func.date(Conversation.last_visitor_message_at))
    )
    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        q = q.filter(Conversation.team_id == team_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/resolved")
def resolved_conversations_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    bot_only: Optional[bool] = Query(None),
):
    """Daily resolved conversation counts, grouped by resolved_at."""
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series)}

    _closed_by_filter = (
        Conversation.closed_by == 'bot'
        if bot_only is True
        else Conversation.closed_by.notin_(['inactivity', 'system_auto', 'bot'])
    )
    q = (
        db.query(
            func.date(Conversation.resolved_at).label("day"),
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.last_visitor_message_at.isnot(None),
            _closed_by_filter,
            _bot_filter(bot_only),
            Conversation.resolved_at.isnot(None),
            Conversation.resolved_at >= start_dt,
            Conversation.resolved_at <= end_dt,
        )
        .group_by(func.date(Conversation.resolved_at))
    )
    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        q = q.filter(Conversation.team_id == team_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/replied")
def replied_conversations_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily count of conversations that received at least one agent reply.

    Counts by the date of the first agent message in each conversation.
    """
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series)}

    first_reply = (
        db.query(
            Message.conversation_id,
            func.min(Message.created_at).label("first_reply_at"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )

    q = (
        db.query(
            func.date(first_reply.c.first_reply_at).label("day"),
            func.count().label("cnt"),
        )
        .join(Conversation, Conversation.id == first_reply.c.conversation_id)
        .filter(
            first_reply.c.first_reply_at >= start_dt,
            first_reply.c.first_reply_at <= end_dt,
        )
        .group_by(func.date(first_reply.c.first_reply_at))
    )
    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        q = q.filter(Conversation.team_id == team_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/response-time")
def response_time_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily median first-response time (seconds).

    Smartsupp uses the median because it's less affected by outliers.
    """
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series, default=0)}

    first_agent_msg = (
        db.query(
            Message.conversation_id,
            func.min(Message.created_at).label("first_agent_at"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )

    rows = (
        db.query(
            func.date(Conversation.created_at).label("day"),
            (
                func.extract("epoch", first_agent_msg.c.first_agent_at)
                - func.extract("epoch", Conversation.created_at)
            ).label("response_seconds"),
        )
        .join(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
    )
    if allowed_ids is not None:
        rows = rows.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        rows = rows.filter(Conversation.team_id == team_id)

    all_rows = rows.all()

    # Group by day and compute median in Python (more portable than SQL percentile).
    from collections import defaultdict
    import statistics

    day_values: dict[str, list[float]] = defaultdict(list)
    for row in all_rows:
        if row.response_seconds is not None and row.response_seconds >= 0:
            day_values[str(row.day)].append(float(row.response_seconds))

    data: dict[str, float] = {}
    for day, vals in day_values.items():
        if vals:
            data[day] = round(statistics.median(vals), 1)

    return {"series": _fill_series(data, series, default=0)}


# ---------------------------------------------------------------------------
# 2. Agent Statistics
# ---------------------------------------------------------------------------

@router.get("/agents/summary")
def agents_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Per-agent breakdown: conversations handled, messages sent, avg response time."""
    start_dt, end_dt = _date_range(start, end)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    # Org-scoped agents only
    from app.services.visibility import compute_visibility_scope
    scope = compute_visibility_scope(db, user=current_user)
    agents_q = db.query(User).filter(
        User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER])
    )
    if scope.organization_id is not None:
        agents_q = agents_q.filter(User.organization_id == scope.organization_id)
    agents = agents_q.all()

    if allowed_ids is not None and not allowed_ids:
        return {"agents": []}

    # Conversations assigned per agent in period — exclude bot-only (no agent handled those).
    assigned_q = (
        db.query(
            Conversation.assigned_agent_id,
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.assigned_agent_id.isnot(None),
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
            Conversation.bot_only == False,  # noqa: E712
        )
    )
    if allowed_ids is not None:
        assigned_q = assigned_q.filter(Conversation.website_id.in_(allowed_ids))
    if team_id is not None:
        assigned_q = assigned_q.filter(Conversation.team_id == team_id)
    assigned_q = assigned_q.group_by(Conversation.assigned_agent_id)
    assigned_map = {row[0]: row[1] for row in assigned_q.all()}

    # Messages sent per agent in period
    msgs_q = (
        db.query(
            Message.sender.label("agent_email"),
            func.count(Message.id).label("cnt"),
        )
        .filter(
            Message.sender_type == MessageSenderType.AGENT,
            Message.created_at >= start_dt,
            Message.created_at <= end_dt,
        )
    )
    if allowed_ids is not None:
        msgs_q = msgs_q.join(Conversation, Conversation.id == Message.conversation_id).filter(
            Conversation.website_id.in_(allowed_ids)
        )
    msgs_q = msgs_q.group_by(Message.sender)
    msgs_map = {row[0]: row[1] for row in msgs_q.all()}

    # First response time per agent (avg)
    first_agent_msg = (
        db.query(
            Message.conversation_id,
            Message.sender.label("agent_email"),
            func.min(Message.created_at).label("first_agent_at"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id, Message.sender)
        .subquery()
    )

    resp_q = (
        db.query(
            first_agent_msg.c.agent_email,
            func.avg(
                func.extract("epoch", first_agent_msg.c.first_agent_at)
                - func.extract("epoch", Conversation.created_at)
            ).label("avg_seconds"),
        )
        .join(Conversation, Conversation.id == first_agent_msg.c.conversation_id)
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
    )
    if allowed_ids is not None:
        resp_q = resp_q.filter(Conversation.website_id.in_(allowed_ids))
    resp_q = resp_q.group_by(first_agent_msg.c.agent_email)
    resp_map = {row[0]: round(row[1], 1) if row[1] else None for row in resp_q.all()}

    result: list[dict[str, Any]] = []
    for agent in agents:
        result.append({
            "id": agent.id,
            "name": agent.name or agent.email,
            "email": agent.email,
            "role": agent.role.value if getattr(agent, 'role', None) else "agent",
            "conversations_handled": assigned_map.get(agent.id, 0),
            "messages_sent": msgs_map.get(agent.email, 0),
            "avg_first_response_seconds": resp_map.get(agent.email),
        })

    # Sort by conversations_handled desc
    result.sort(key=lambda a: a["conversations_handled"], reverse=True)
    return {"agents": result}


# ---------------------------------------------------------------------------
# 2b. Team Statistics
# ---------------------------------------------------------------------------

@router.get("/teams/summary")
def teams_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Per-team breakdown: conversations, resolved, avg first-response time."""
    start_dt, end_dt = _date_range(start, end)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"teams": []}

    # Fetch teams the user can see
    from app.services.visibility import compute_visibility_scope
    scope = compute_visibility_scope(db, user=current_user)
    teams_q = db.query(WebsiteTeam, Website.name.label("website_name")).join(
        Website, Website.id == WebsiteTeam.website_id
    )
    if allowed_ids is not None:
        teams_q = teams_q.filter(WebsiteTeam.website_id.in_(allowed_ids))
    teams = teams_q.all()

    if not teams:
        return {"teams": []}

    team_ids = [t.WebsiteTeam.id for t in teams]

    # Conversations per team — counted on first-interaction date, exclude bot-only.
    conv_q = (
        db.query(
            Conversation.team_id,
            func.count(Conversation.id).label("total"),
        )
        .filter(
            Conversation.team_id.in_(team_ids),
            Conversation.last_visitor_message_at.isnot(None),
            Conversation.last_visitor_message_at >= start_dt,
            Conversation.last_visitor_message_at <= end_dt,
            Conversation.bot_only == False,  # noqa: E712
        )
        .group_by(Conversation.team_id)
    )
    conv_map = {row[0]: row[1] for row in conv_q.all()}

    # Resolved per team — counted on resolved_at date.
    resolved_q = (
        db.query(
            Conversation.team_id,
            func.count(Conversation.id).label("total"),
        )
        .filter(
            Conversation.team_id.in_(team_ids),
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.last_visitor_message_at.isnot(None),
            Conversation.closed_by.notin_(['inactivity', 'system_auto', 'bot']),
            Conversation.bot_only == False,  # noqa: E712
            Conversation.resolved_at.isnot(None),
            Conversation.resolved_at >= start_dt,
            Conversation.resolved_at <= end_dt,
        )
        .group_by(Conversation.team_id)
    )
    resolved_map = {row[0]: row[1] for row in resolved_q.all()}

    # Avg first-response per team
    first_agent_msg = (
        db.query(
            Message.conversation_id,
            func.min(Message.created_at).label("first_agent_at"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )
    resp_q = (
        db.query(
            Conversation.team_id,
            func.avg(
                func.extract("epoch", first_agent_msg.c.first_agent_at)
                - func.extract("epoch", Conversation.created_at)
            ).label("avg_seconds"),
        )
        .join(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
        .filter(
            Conversation.team_id.in_(team_ids),
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
        .group_by(Conversation.team_id)
    )
    resp_map = {row[0]: round(row[1], 1) if row[1] else None for row in resp_q.all()}

    result = [
        {
            "id": t.WebsiteTeam.id,
            "name": t.WebsiteTeam.name,
            "website_name": t.website_name,
            "conversations": conv_map.get(t.WebsiteTeam.id, 0),
            "resolved": resolved_map.get(t.WebsiteTeam.id, 0),
            "avg_response_seconds": resp_map.get(t.WebsiteTeam.id),
        }
        for t in teams
    ]
    result.sort(key=lambda t: t["conversations"], reverse=True)
    return {"teams": result}

@router.get("/tags/summary")
def tags_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Tag usage counts for the selected period."""
    start_dt, end_dt = _date_range(start, end)

    # Enforce visibility: only include tags for websites the user can access
    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"tags": []}

    # Filter by conversation creation date so tags applied retroactively
    # to old conversations don't shift into the current reporting period.
    q = (
        db.query(
            Tag.id,
            Tag.name,
            Tag.color,
            func.count(ConversationTag.id).label("usage_count"),
        )
        .join(ConversationTag, ConversationTag.tag_id == Tag.id)
        .join(Conversation, Conversation.id == ConversationTag.conversation_id)
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
    )
    if allowed_ids is not None:
        q = q.filter(Tag.website_id.in_(allowed_ids))

    q = q.group_by(Tag.id, Tag.name, Tag.color).order_by(func.count(ConversationTag.id).desc())

    results = [
        {
            "id": row.id,
            "name": row.name,
            "color": row.color,
            "usage_count": row.usage_count,
        }
        for row in q.all()
    ]

    return {"tags": results}


# ---------------------------------------------------------------------------
# 4. Overview (combined KPIs for dashboard cards)
# ---------------------------------------------------------------------------

@router.get("/overview")
def analytics_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Combined overview KPIs — always returns agent and bot splits side by side."""
    start_dt, end_dt = _date_range(start, end)
    period_days = (end_dt.date() - start_dt.date()).days + 1

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    prev_end_dt = start_dt - timedelta(seconds=1)
    prev_start_dt = prev_end_dt - timedelta(days=period_days - 1)
    prev_start_dt = datetime.combine(prev_start_dt.date(), time.min, tzinfo=timezone.utc)

    _empty_metric = {"value": 0, "previous": 0, "change_pct": None}

    if allowed_ids is not None and not allowed_ids:
        return {
            "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
            "previous_period": {"start": prev_start_dt.date().isoformat(), "end": prev_end_dt.date().isoformat()},
            "new_conversations": {"agent": _empty_metric, "bot": _empty_metric},
            "resolved_conversations": {"agent": _empty_metric, "bot": _empty_metric},
            "avg_first_response_seconds": {"agent": {"value": None, "previous": None, "change_pct": None}},
        }

    def _count_new(s: datetime, e: datetime, for_bot: bool) -> int:
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.last_visitor_message_at.isnot(None),
            Conversation.last_visitor_message_at >= s,
            Conversation.last_visitor_message_at <= e,
            Conversation.bot_only == for_bot,  # noqa: E712
        )
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
        return q.scalar() or 0

    def _count_resolved(s: datetime, e: datetime, for_bot: bool) -> int:
        closed_by_filter = (
            Conversation.closed_by == 'bot'
            if for_bot
            else Conversation.closed_by.notin_(['inactivity', 'system_auto', 'bot'])
        )
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.last_visitor_message_at.isnot(None),
            closed_by_filter,
            Conversation.bot_only == for_bot,  # noqa: E712
            Conversation.resolved_at.isnot(None),
            Conversation.resolved_at >= s,
            Conversation.resolved_at <= e,
        )
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
        return q.scalar() or 0

    def _avg_response(s: datetime, e: datetime) -> float | None:
        """Agent-only first-response time (bots have no agent replies)."""
        first_agent_msg = (
            db.query(
                Message.conversation_id,
                func.min(Message.created_at).label("first_agent_at"),
            )
            .filter(Message.sender_type == MessageSenderType.AGENT)
            .group_by(Message.conversation_id)
            .subquery()
        )
        q = (
            db.query(
                func.avg(
                    func.extract("epoch", first_agent_msg.c.first_agent_at)
                    - func.extract("epoch", Conversation.created_at)
                )
            )
            .join(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
            .filter(
                Conversation.bot_only == False,  # noqa: E712
                Conversation.created_at >= s,
                Conversation.created_at <= e,
            )
        )
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
        val = q.scalar()
        return round(val, 1) if val else None

    def _pct_change(current: int | float | None, previous: int | float | None) -> float | None:
        if previous is None or previous == 0 or current is None:
            return None
        return round(((current - previous) / previous) * 100, 1)

    def _metric(cur, prev):
        return {"value": cur, "previous": prev, "change_pct": _pct_change(cur, prev)}

    # Compute all values (agent + bot, current + previous periods)
    cur_agent_new = _count_new(start_dt, end_dt, for_bot=False)
    prev_agent_new = _count_new(prev_start_dt, prev_end_dt, for_bot=False)
    cur_bot_new = _count_new(start_dt, end_dt, for_bot=True)
    prev_bot_new = _count_new(prev_start_dt, prev_end_dt, for_bot=True)

    cur_agent_res = _count_resolved(start_dt, end_dt, for_bot=False)
    prev_agent_res = _count_resolved(prev_start_dt, prev_end_dt, for_bot=False)
    cur_bot_res = _count_resolved(start_dt, end_dt, for_bot=True)
    prev_bot_res = _count_resolved(prev_start_dt, prev_end_dt, for_bot=True)

    cur_response = _avg_response(start_dt, end_dt)
    prev_response = _avg_response(prev_start_dt, prev_end_dt)

    return {
        "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
        "previous_period": {"start": prev_start_dt.date().isoformat(), "end": prev_end_dt.date().isoformat()},
        "new_conversations": {
            "agent": _metric(cur_agent_new, prev_agent_new),
            "bot": _metric(cur_bot_new, prev_bot_new),
        },
        "resolved_conversations": {
            "agent": _metric(cur_agent_res, prev_agent_res),
            "bot": _metric(cur_bot_res, prev_bot_res),
        },
        "avg_first_response_seconds": {
            "agent": _metric(cur_response, prev_response),
        },
    }


# ---------------------------------------------------------------------------
# Ratings summary
# ---------------------------------------------------------------------------

@router.get("/ratings/summary")
def ratings_summary(
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Satisfaction rating breakdown for the period."""
    start_dt, end_dt = _date_range(start, end)

    q = (
        db.query(
            ConversationRating.rating,
            func.count(ConversationRating.id).label("cnt"),
        )
        .join(Conversation, Conversation.id == ConversationRating.conversation_id)
        .filter(ConversationRating.created_at >= start_dt)
        .filter(ConversationRating.created_at <= end_dt)
    )
    if website_id:
        q = q.filter(Conversation.website_id == website_id)

    rows = q.group_by(ConversationRating.rating).all()

    counts = {1: 0, 0: 0, -1: 0}
    for rating_val, cnt in rows:
        counts[rating_val] = cnt

    total = sum(counts.values())
    return {
        "total": total,
        "good": counts[1],
        "neutral": counts[0],
        "bad": counts[-1],
        "good_pct": round(counts[1] / total * 100, 1) if total else 0,
        "neutral_pct": round(counts[0] / total * 100, 1) if total else 0,
        "bad_pct": round(counts[-1] / total * 100, 1) if total else 0,
    }


@router.get("/export_xlsx")
def export_xlsx(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    rating: Optional[int] = Query(None),
    tag_ids: Optional[str] = Query(None),
):
    """Stream an XLSX report for the selected period and website(s) with optional filters."""
    start_dt, end_dt = _date_range(start, end)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    # Parse tag_ids CSV
    parsed_tag_ids: list[int] = []
    if tag_ids:
        try:
            parsed_tag_ids = [int(x) for x in tag_ids.split(",") if x.strip()]
        except ValueError:
            pass

    _REPORT_HEADERS = [
        "Conversation ID", "Status", "Website", "Team",
        "Visitor Name", "Visitor Email", "Visitor Phone", "Contact Filled",
        "Session ID", "Visitor IP", "Device", "Browser",
        "Agents",
        "Started At", "Resolved At", "Chat Duration (mins)", "First Response Time (s)",
        "Visitor Messages", "Agent Messages",
        "Rating", "Rating Feedback", "Closed By", "Tags",
        "Lead Source", "Referrer", "Page URL",
    ]
    _REPORT_DESCRIPTIONS = [
        "Short unique conversation ID", "OPEN or RESOLVED", "Website name", "Routed team name",
        "Visitor's name (if provided)", "Visitor's email (if provided)", "Visitor's phone (if provided)",
        "Yes if any contact field was filled by visitor",
        "Browser session identifier", "Visitor IP address", "Device type", "Browser name/version",
        "Assigned agent + all agents who sent a message (comma-separated, deduplicated)",
        "Timestamp of first visitor interaction", "Timestamp conversation was resolved",
        "Minutes from first interaction to resolution (blank if unresolved)",
        "Seconds from first interaction to first agent reply",
        "Number of messages sent by visitor", "Number of messages sent by agents",
        "Visitor rating: Good / Neutral / Bad", "Free-text feedback from visitor rating",
        "How conversation ended (agent/visitor/inactivity/bot)",
        "Comma-separated tags applied to conversation",
        "utm_source from page URL if present, otherwise 'direct'",
        "HTTP referrer URL of visitor's first page view",
        "URL of the visitor's first page view",
    ]

    # Empty workbook if user has no accessible websites
    if allowed_ids is not None and not allowed_ids:
        wb = Workbook(write_only=True)
        ws = wb.create_sheet()
        ws.append(_REPORT_HEADERS)
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        filename = f"analytics_{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.xlsx"
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    # Aliases for user lookups
    assigned_user = aliased(User)
    msg_user = aliased(User)

    # first agent message timestamp per conversation
    first_agent_at = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            func.min(Message.created_at).label("first_agent_at"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )

    # first agent message row to get sender
    first_agent_msg = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            Message.sender.label("agent_sender"),
            Message.created_at.label("agent_msg_at"),
        )
        .join(first_agent_at, and_(
            Message.conversation_id == first_agent_at.c.conversation_id,
            Message.created_at == first_agent_at.c.first_agent_at,
        ))
        .subquery()
    )

    # First pageview timestamp/url for conversations that have conversation_id set
    first_pv_at = (
        db.query(
            ConversationPageView.conversation_id.label("conversation_id"),
            func.min(ConversationPageView.created_at).label("first_pv_at"),
        )
        .group_by(ConversationPageView.conversation_id)
        .subquery()
    )
    first_pv = (
        db.query(
            ConversationPageView.conversation_id.label("conversation_id"),
            ConversationPageView.created_at.label("first_pv_at"),
            ConversationPageView.url.label("url"),
        )
        .join(first_pv_at, and_(
            ConversationPageView.conversation_id == first_pv_at.c.conversation_id,
            ConversationPageView.created_at == first_pv_at.c.first_pv_at,
        ))
        .subquery()
    )

    # First pageview per session (fallback when conversation_id is not present on pageviews)
    first_pv_session_at_q = db.query(
        ConversationPageView.session_id.label("session_id"),
        func.min(ConversationPageView.created_at).label("first_pv_at"),
    ).group_by(ConversationPageView.session_id)
    if allowed_ids is not None:
        first_pv_session_at_q = first_pv_session_at_q.filter(ConversationPageView.website_id.in_(allowed_ids))
    first_pv_session_at = first_pv_session_at_q.subquery()

    first_pv_session = (
        db.query(
            ConversationPageView.session_id.label("session_id"),
            ConversationPageView.created_at.label("first_pv_at"),
            ConversationPageView.url.label("session_url"),
        )
        .join(first_pv_session_at, and_(
            ConversationPageView.session_id == first_pv_session_at.c.session_id,
            ConversationPageView.created_at == first_pv_session_at.c.first_pv_at,
        ))
        .subquery()
    )

    # tags aggregated per conversation
    tags_subq = (
        db.query(
            ConversationTag.conversation_id.label("conversation_id"),
            func.string_agg(Tag.name, ", ").label("tags"),
        )
        .join(Tag, Tag.id == ConversationTag.tag_id)
        .group_by(ConversationTag.conversation_id)
        .subquery()
    )

    # All agent names who sent at least one message per conversation (joined agents)
    agents_involved_subq = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            func.string_agg(distinct(func.coalesce(User.name, Message.sender)), ", ").label("agents_involved"),
        )
        .outerjoin(User, User.email == Message.sender)
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )

    # Message counts per conversation split by sender type
    visitor_msg_count_subq = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            func.count(Message.id).label("visitor_msg_count"),
        )
        .filter(Message.sender_type == MessageSenderType.VISITOR)
        .group_by(Message.conversation_id)
        .subquery()
    )
    agent_msg_count_subq = (
        db.query(
            Message.conversation_id.label("conversation_id"),
            func.count(Message.id).label("agent_msg_count"),
        )
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .group_by(Message.conversation_id)
        .subquery()
    )

    # First page-view referrer per conversation (traffic source / lead source)
    first_pv_referrer_subq = (
        db.query(
            ConversationPageView.conversation_id.label("conversation_id"),
            ConversationPageView.referrer.label("referrer"),
            ConversationPageView.created_at.label("pv_created_at"),
        )
        .filter(ConversationPageView.conversation_id.isnot(None))
        .distinct(ConversationPageView.conversation_id)
        .order_by(ConversationPageView.conversation_id, ConversationPageView.created_at)
        .subquery()
    )

    # Aliased joins for new columns
    website_alias = aliased(Website)
    team_alias = aliased(WebsiteTeam)
    rating_alias = aliased(ConversationRating)

    # Main query selecting all export columns
    q = (
        db.query(
            Conversation.short_id.label("short_id"),
            Conversation.status.label("status"),
            website_alias.name.label("website_name"),
            team_alias.name.label("team_name"),
            Conversation.visitor_name.label("visitor_name"),
            Conversation.visitor_email.label("visitor_email"),
            Conversation.visitor_phone.label("visitor_phone"),
            Conversation.session_id.label("session_id"),
            Conversation.visitor_ip.label("visitor_ip"),
            Conversation.device_info.label("device_info"),
            Conversation.browser_info.label("browser_info"),
            func.coalesce(assigned_user.name, msg_user.name, first_agent_msg.c.agent_sender).label("agent_name"),
            agents_involved_subq.c.agents_involved.label("agents_involved"),
            func.coalesce(first_pv.c.first_pv_at, first_pv_session.c.first_pv_at, Conversation.created_at).label("date_with_time"),
            Conversation.resolved_at.label("resolved_at"),
            func.extract(
                "epoch",
                Conversation.resolved_at - func.coalesce(first_pv.c.first_pv_at, first_pv_session.c.first_pv_at, Conversation.created_at)
            ).label("chat_duration_seconds"),
            (func.extract("epoch", first_agent_at.c.first_agent_at) - func.extract("epoch", Conversation.created_at)).label("response_time_seconds"),
            func.coalesce(visitor_msg_count_subq.c.visitor_msg_count, 0).label("visitor_msg_count"),
            func.coalesce(agent_msg_count_subq.c.agent_msg_count, 0).label("agent_msg_count"),
            rating_alias.rating.label("rating"),
            rating_alias.feedback.label("rating_feedback"),
            Conversation.closed_by.label("closed_by"),
            func.coalesce(tags_subq.c.tags, "").label("tags"),
            func.coalesce(first_pv_referrer_subq.c.referrer, "").label("referrer"),
            func.coalesce(first_pv.c.url, first_pv_session.c.session_url).label("page_url"),
        )
        .outerjoin(website_alias, website_alias.id == Conversation.website_id)
        .outerjoin(team_alias, team_alias.id == Conversation.team_id)
        .outerjoin(rating_alias, rating_alias.conversation_id == Conversation.id)
        .outerjoin(assigned_user, assigned_user.id == Conversation.assigned_agent_id)
        .outerjoin(first_agent_at, first_agent_at.c.conversation_id == Conversation.id)
        .outerjoin(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
        .outerjoin(msg_user, msg_user.email == first_agent_msg.c.agent_sender)
        .outerjoin(tags_subq, tags_subq.c.conversation_id == Conversation.id)
        .outerjoin(agents_involved_subq, agents_involved_subq.c.conversation_id == Conversation.id)
        .outerjoin(visitor_msg_count_subq, visitor_msg_count_subq.c.conversation_id == Conversation.id)
        .outerjoin(agent_msg_count_subq, agent_msg_count_subq.c.conversation_id == Conversation.id)
        .outerjoin(first_pv, first_pv.c.conversation_id == Conversation.id)
        .outerjoin(first_pv_session, first_pv_session.c.session_id == Conversation.session_id)
        .outerjoin(first_pv_referrer_subq, first_pv_referrer_subq.c.conversation_id == Conversation.id)
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
            Conversation.last_visitor_message_at.isnot(None),
        )
    )

    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))

    # Optional extra filters
    if agent_id is not None:
        q = q.filter(Conversation.assigned_agent_id == agent_id)
    if team_id is not None:
        q = q.filter(Conversation.team_id == team_id)
    if rating is not None:
        rated_conv_ids = (
            db.query(ConversationRating.conversation_id)
            .filter(ConversationRating.rating == rating)
            .scalar_subquery()
        )
        q = q.filter(Conversation.id.in_(rated_conv_ids))
    if parsed_tag_ids:
        for tid in parsed_tag_ids:
            q = q.filter(
                Conversation.id.in_(
                    db.query(ConversationTag.conversation_id).filter(ConversationTag.tag_id == tid)
                )
            )

    def _fmt_dt(dt_val) -> str:
        if dt_val is None:
            return ""
        if isinstance(dt_val, str):
            try:
                dt_val = datetime.fromisoformat(dt_val)
            except Exception:
                return str(dt_val)
        try:
            return f"{dt_val.date().isoformat()}  {dt_val.strftime('%I:%M:%S%p')}"
        except Exception:
            return str(dt_val)

    _RATING_LABEL = {1: "Good", 0: "Neutral", -1: "Bad"}

    # Create write-only workbook and stream rows
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title="Analytics")
    ws.append(_REPORT_HEADERS)
    ws.append(_REPORT_DESCRIPTIONS)

    for row in q.yield_per(200):
        status_val = row.status.value if hasattr(row.status, "value") else str(row.status or "")
        rating_val = _RATING_LABEL.get(row.rating, "") if row.rating is not None else ""

        # Contact Filled: Yes if any of name/email/phone is present
        contact_filled = "Yes" if any([row.visitor_name, row.visitor_email, row.visitor_phone]) else "No"

        # Agents: merge assigned agent + all who sent a message, deduplicated, ordered
        _agents_seen: list[str] = []
        _agents_set: set[str] = set()
        for _n in [row.agent_name] + (row.agents_involved.split(", ") if row.agents_involved else []):
            _n = (_n or "").strip()
            if _n and _n not in _agents_set:
                _agents_set.add(_n)
                _agents_seen.append(_n)
        agents_col = ", ".join(_agents_seen)

        # Chat duration in minutes — computed in SQL via epoch extraction
        chat_duration_mins = round(float(row.chat_duration_seconds) / 60, 2) if row.chat_duration_seconds is not None else ""

        # Lead source: utm_source from page URL query string, else "direct"
        lead_source = "direct"
        if row.page_url:
            try:
                _qs = parse_qs(urlparse(row.page_url).query)
                _utm = _qs.get("utm_source", [None])[0]
                if _utm:
                    lead_source = _utm
            except Exception:
                pass

        ws.append([
            row.short_id or "",
            status_val,
            row.website_name or "",
            row.team_name or "",
            row.visitor_name or "",
            row.visitor_email or "",
            row.visitor_phone or "",
            contact_filled,
            row.session_id or "",
            row.visitor_ip or "",
            row.device_info or "",
            row.browser_info or "",
            agents_col,
            _fmt_dt(row.date_with_time),
            _fmt_dt(row.resolved_at),
            chat_duration_mins,
            float(row.response_time_seconds) if row.response_time_seconds is not None else "",
            int(row.visitor_msg_count) if row.visitor_msg_count is not None else 0,
            int(row.agent_msg_count) if row.agent_msg_count is not None else 0,
            rating_val,
            row.rating_feedback or "",
            row.closed_by or "",
            row.tags or "",
            lead_source,
            row.referrer or "",
            row.page_url or "",
        ])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    filename = f"analytics_{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.xlsx"
    return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/export_transcripts")
def export_transcripts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    rating: Optional[int] = Query(None),
    tag_ids: Optional[str] = Query(None),
):
    """Export full conversation transcripts as a flat XLSX table (one row per message)."""
    start_dt, end_dt = _date_range(start, end)
    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    parsed_tag_ids: list[int] = []
    if tag_ids:
        try:
            parsed_tag_ids = [int(x) for x in tag_ids.split(",") if x.strip()]
        except ValueError:
            pass

    if allowed_ids is not None and not allowed_ids:
        wb = Workbook(write_only=True)
        ws = wb.create_sheet("Transcripts")
        ws.append(["No accessible conversations"])
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": 'attachment; filename="transcripts.xlsx"'})

    # Build conversation query
    conv_q = (
        db.query(Conversation)
        .filter(Conversation.created_at >= start_dt, Conversation.created_at <= end_dt)
        .filter(Conversation.last_visitor_message_at.isnot(None))
    )
    if allowed_ids is not None:
        conv_q = conv_q.filter(Conversation.website_id.in_(allowed_ids))
    if agent_id is not None:
        conv_q = conv_q.filter(Conversation.assigned_agent_id == agent_id)
    if team_id is not None:
        conv_q = conv_q.filter(Conversation.team_id == team_id)
    if rating is not None:
        rated_ids = (
            db.query(ConversationRating.conversation_id)
            .filter(ConversationRating.rating == rating)
            .scalar_subquery()
        )
        conv_q = conv_q.filter(Conversation.id.in_(rated_ids))
    if parsed_tag_ids:
        for tid in parsed_tag_ids:
            conv_q = conv_q.filter(
                Conversation.id.in_(
                    db.query(ConversationTag.conversation_id).filter(ConversationTag.tag_id == tid)
                )
            )

    conversations = conv_q.order_by(Conversation.created_at.desc()).limit(500).all()

    conv_ids = [c.id for c in conversations]

    # Batch load website names
    website_ids_needed = {c.website_id for c in conversations}
    websites_map: dict[int, str] = {}
    if website_ids_needed:
        for w in db.query(Website).filter(Website.id.in_(website_ids_needed)).all():
            websites_map[w.id] = w.name

    # Batch load agent names
    agent_ids_needed = {c.assigned_agent_id for c in conversations if c.assigned_agent_id}
    agents_map: dict[int, str] = {}
    if agent_ids_needed:
        for u in db.query(User).filter(User.id.in_(agent_ids_needed)).all():
            agents_map[u.id] = u.name or u.email

    # Batch load team names
    team_ids_needed = {c.team_id for c in conversations if c.team_id}
    teams_map: dict[int, str] = {}
    if team_ids_needed:
        for t in db.query(WebsiteTeam).filter(WebsiteTeam.id.in_(team_ids_needed)).all():
            teams_map[t.id] = t.name

    # Batch load ratings
    ratings_map: dict[int, int] = {}
    if conv_ids:
        for r in db.query(ConversationRating).filter(ConversationRating.conversation_id.in_(conv_ids)).all():
            ratings_map[r.conversation_id] = r.rating

    # Batch load messages by conversation to avoid N+1 queries.
    messages_map: dict[int, list[Message]] = {}
    if conv_ids:
        for msg in (
            db.query(Message)
            .filter(Message.conversation_id.in_(conv_ids))
            .order_by(Message.conversation_id.asc(), Message.created_at.asc(), Message.id.asc())
            .all()
        ):
            messages_map.setdefault(msg.conversation_id, []).append(msg)

    # Batch load tags per conversation
    tags_map: dict[int, str] = {}
    if conv_ids:
        tag_rows = (
            db.query(ConversationTag.conversation_id, Tag.name)
            .join(Tag, Tag.id == ConversationTag.tag_id)
            .filter(ConversationTag.conversation_id.in_(conv_ids))
            .all()
        )
        for conv_id_row, tag_name in tag_rows:
            tags_map.setdefault(conv_id_row, []).append(tag_name)  # type: ignore[arg-type]
        tags_map = {k: ", ".join(v) for k, v in tags_map.items()}  # type: ignore[assignment]

    _RATING_LABEL_T = {1: "Good", 0: "Neutral", -1: "Bad"}

    # Build XLSX — single flat table: one row per message, conversation
    # metadata repeated on each row so the sheet is filterable/sortable.
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Transcripts")

    ws.append([
        "Conversation ID", "Status", "Website", "Team",
        "Visitor Name", "Visitor Email", "Visitor Phone", "Session ID", "Visitor IP",
        "Device", "Browser",
        "Agent", "Rating", "Tags", "Closed By", "Conv Started At",
        "Timestamp", "Sender", "Message Type", "Message",
    ])

    for conv in conversations:
        msgs = messages_map.get(conv.id, [])
        conv_short = conv.short_id or str(conv.id)
        status = conv.status.value if hasattr(conv.status, "value") else str(conv.status)
        website = websites_map.get(conv.website_id, f"Website {conv.website_id}")
        team = teams_map.get(conv.team_id, "") if conv.team_id else ""
        visitor_name = conv.visitor_name or ""
        visitor_email = conv.visitor_email or ""
        visitor_phone = getattr(conv, "visitor_phone", "") or ""
        session_id = conv.session_id or ""
        visitor_ip = getattr(conv, "visitor_ip", "") or ""
        device = getattr(conv, "device_info", "") or ""
        browser = getattr(conv, "browser_info", "") or ""
        agent = agents_map.get(conv.assigned_agent_id, "") if conv.assigned_agent_id else ""
        raw_rating = ratings_map.get(conv.id)
        rating = _RATING_LABEL_T.get(raw_rating, "") if raw_rating is not None else ""
        tags = tags_map.get(conv.id, "")
        closed_by = getattr(conv, "closed_by", "") or ""
        started = conv.created_at.strftime("%Y-%m-%d %H:%M") if conv.created_at else ""

        for msg in msgs:
            sender = msg.sender or (
                msg.sender_type.value if hasattr(msg.sender_type, "value") else str(msg.sender_type)
            )
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else ""
            msg_type = msg.event_type or ""
            content = msg.content or ""
            ws.append([
                conv_short, status, website, team,
                visitor_name, visitor_email, visitor_phone, session_id, visitor_ip,
                device, browser,
                agent, rating, tags, closed_by, started,
                ts, sender, msg_type, content,
            ])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    filename = f"transcripts_{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.xlsx"
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
