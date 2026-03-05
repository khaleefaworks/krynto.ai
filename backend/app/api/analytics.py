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

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, case, and_, distinct
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.models.conversation_tag import ConversationTag
from app.models.conversation_rating import ConversationRating
from app.models.tag import Tag
from app.models.user import User, UserRole
from app.api.deps import get_current_user

logger = get_logger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


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


# ---------------------------------------------------------------------------
# 1. Conversation Statistics
# ---------------------------------------------------------------------------

@router.get("/conversations/summary")
def conversation_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """High-level conversation KPIs for the selected period."""
    start_dt, end_dt = _date_range(start, end)

    base = db.query(Conversation).filter(
        Conversation.created_at >= start_dt,
        Conversation.created_at <= end_dt,
    )
    if website_id:
        base = base.filter(Conversation.website_id == website_id)

    total_new = base.count()

    total_resolved = base.filter(
        Conversation.status == ConversationStatus.RESOLVED,
    ).count()

    # Replied = conversations that have at least one agent message
    replied_subq = (
        db.query(Message.conversation_id)
        .filter(Message.sender_type == MessageSenderType.AGENT)
        .distinct()
        .subquery()
    )
    total_replied = base.filter(
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
    if website_id:
        response_rows = response_rows.filter(Conversation.website_id == website_id)

    avg_response_seconds = response_rows.scalar()

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
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily new conversation counts."""
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    q = (
        db.query(
            func.date(Conversation.created_at).label("day"),
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
        .group_by(func.date(Conversation.created_at))
    )
    if website_id:
        q = q.filter(Conversation.website_id == website_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/resolved")
def resolved_conversations_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily resolved conversation counts.

    Uses ``updated_at`` as the resolution timestamp since there's no
    dedicated ``resolved_at`` column.
    """
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    q = (
        db.query(
            func.date(Conversation.updated_at).label("day"),
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.updated_at >= start_dt,
            Conversation.updated_at <= end_dt,
        )
        .group_by(func.date(Conversation.updated_at))
    )
    if website_id:
        q = q.filter(Conversation.website_id == website_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/replied")
def replied_conversations_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily count of conversations that received at least one agent reply.

    Counts by the date of the first agent message in each conversation.
    """
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

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
    if website_id:
        q = q.filter(Conversation.website_id == website_id)

    data = {str(row.day): row.cnt for row in q.all()}
    return {"series": _fill_series(data, series)}


@router.get("/conversations/response-time")
def response_time_chart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    website_id: Optional[int] = Query(None),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily median first-response time (seconds).

    Smartsupp uses the median because it's less affected by outliers.
    """
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

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
    if website_id:
        rows = rows.filter(Conversation.website_id == website_id)

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
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Per-agent breakdown: conversations handled, messages sent, avg response time."""
    start_dt, end_dt = _date_range(start, end)

    # All agent-role users
    agents = (
        db.query(User)
        .filter(User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER]))
        .all()
    )

    # Conversations assigned per agent in period
    assigned_q = (
        db.query(
            Conversation.assigned_agent_id,
            func.count(Conversation.id).label("cnt"),
        )
        .filter(
            Conversation.assigned_agent_id.isnot(None),
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
    )
    if website_id:
        assigned_q = assigned_q.filter(Conversation.website_id == website_id)
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
    if website_id:
        msgs_q = msgs_q.join(Conversation, Conversation.id == Message.conversation_id).filter(
            Conversation.website_id == website_id
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
    if website_id:
        resp_q = resp_q.filter(Conversation.website_id == website_id)
    resp_q = resp_q.group_by(first_agent_msg.c.agent_email)
    resp_map = {row[0]: round(row[1], 1) if row[1] else None for row in resp_q.all()}

    result: list[dict[str, Any]] = []
    for agent in agents:
        result.append({
            "id": agent.id,
            "name": agent.name or agent.email,
            "email": agent.email,
            "role": agent.role.value if agent.role else "agent",
            "conversations_handled": assigned_map.get(agent.id, 0),
            "messages_sent": msgs_map.get(agent.email, 0),
            "avg_first_response_seconds": resp_map.get(agent.email),
        })

    # Sort by conversations_handled desc
    result.sort(key=lambda a: a["conversations_handled"], reverse=True)
    return {"agents": result}


# ---------------------------------------------------------------------------
# 3. Tag Statistics
# ---------------------------------------------------------------------------

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
            ConversationTag.created_at >= start_dt,
            ConversationTag.created_at <= end_dt,
        )
    )
    if website_id:
        q = q.filter(Tag.website_id == website_id)

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
    """Combined overview with KPIs + comparison to previous period."""
    start_dt, end_dt = _date_range(start, end)
    period_days = (end_dt.date() - start_dt.date()).days + 1

    prev_end_dt = start_dt - timedelta(seconds=1)
    prev_start_dt = prev_end_dt - timedelta(days=period_days - 1)
    prev_start_dt = datetime.combine(prev_start_dt.date(), time.min, tzinfo=timezone.utc)

    def _count_conversations(s: datetime, e: datetime) -> int:
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.created_at >= s,
            Conversation.created_at <= e,
        )
        if website_id:
            q = q.filter(Conversation.website_id == website_id)
        return q.scalar() or 0

    def _count_resolved(s: datetime, e: datetime) -> int:
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.updated_at >= s,
            Conversation.updated_at <= e,
        )
        if website_id:
            q = q.filter(Conversation.website_id == website_id)
        return q.scalar() or 0

    def _avg_response(s: datetime, e: datetime) -> float | None:
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
                Conversation.created_at >= s,
                Conversation.created_at <= e,
            )
        )
        if website_id:
            q = q.filter(Conversation.website_id == website_id)
        val = q.scalar()
        return round(val, 1) if val else None

    current_new = _count_conversations(start_dt, end_dt)
    prev_new = _count_conversations(prev_start_dt, prev_end_dt)

    current_resolved = _count_resolved(start_dt, end_dt)
    prev_resolved = _count_resolved(prev_start_dt, prev_end_dt)

    current_response = _avg_response(start_dt, end_dt)
    prev_response = _avg_response(prev_start_dt, prev_end_dt)

    def _pct_change(current: int | float | None, previous: int | float | None) -> float | None:
        if previous is None or previous == 0:
            return None
        if current is None:
            return None
        return round(((current - previous) / previous) * 100, 1)

    return {
        "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
        "previous_period": {"start": prev_start_dt.date().isoformat(), "end": prev_end_dt.date().isoformat()},
        "new_conversations": {
            "value": current_new,
            "previous": prev_new,
            "change_pct": _pct_change(current_new, prev_new),
        },
        "resolved_conversations": {
            "value": current_resolved,
            "previous": prev_resolved,
            "change_pct": _pct_change(current_resolved, prev_resolved),
        },
        "avg_first_response_seconds": {
            "value": current_response,
            "previous": prev_response,
            "change_pct": _pct_change(current_response, prev_response),
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
