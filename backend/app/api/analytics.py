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

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)

    base = db.query(Conversation).filter(
        Conversation.created_at >= start_dt,
        Conversation.created_at <= end_dt,
    )
    if allowed_ids is not None:
        if not allowed_ids:
            return {
                "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
                "total_new": 0, "total_replied": 0, "total_resolved": 0,
                "avg_first_response_seconds": None,
            }
        base = base.filter(Conversation.website_id.in_(allowed_ids))

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
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Daily new conversation counts."""
    start_dt, end_dt = _date_range(start, end)
    series = _date_series(start_dt, end_dt)

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series)}

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
    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))

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

    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"series": _fill_series({}, series)}

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
    if allowed_ids is not None:
        q = q.filter(Conversation.website_id.in_(allowed_ids))

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
    if allowed_ids is not None:
        assigned_q = assigned_q.filter(Conversation.website_id.in_(allowed_ids))
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

    # Enforce visibility: only include tags for websites the user can access
    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        return {"tags": []}

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
    """Combined overview with KPIs + comparison to previous period."""
    start_dt, end_dt = _date_range(start, end)
    period_days = (end_dt.date() - start_dt.date()).days + 1

    # Enforce visibility scope for overview queries
    allowed_ids = _allowed_website_ids(db, current_user=current_user, requested_website_id=website_id)
    if allowed_ids is not None and not allowed_ids:
        # No accessible websites for this user → return empty KPIs
        return {
            "period": {"start": start_dt.date().isoformat(), "end": end_dt.date().isoformat()},
            "previous_period": {"start": prev_start_dt.date().isoformat(), "end": prev_end_dt.date().isoformat()},
            "new_conversations": {"value": 0, "previous": 0, "change_pct": None},
            "resolved_conversations": {"value": 0, "previous": 0, "change_pct": None},
            "avg_first_response_seconds": {"value": None, "previous": None, "change_pct": None},
        }

    prev_end_dt = start_dt - timedelta(seconds=1)
    prev_start_dt = prev_end_dt - timedelta(days=period_days - 1)
    prev_start_dt = datetime.combine(prev_start_dt.date(), time.min, tzinfo=timezone.utc)

    def _count_conversations(s: datetime, e: datetime) -> int:
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.created_at >= s,
            Conversation.created_at <= e,
        )
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
        return q.scalar() or 0

    def _count_resolved(s: datetime, e: datetime) -> int:
        q = db.query(func.count(Conversation.id)).filter(
            Conversation.status == ConversationStatus.RESOLVED,
            Conversation.updated_at >= s,
            Conversation.updated_at <= e,
        )
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
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
        if allowed_ids is not None:
            q = q.filter(Conversation.website_id.in_(allowed_ids))
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

    # Empty workbook if user has no accessible websites
    if allowed_ids is not None and not allowed_ids:
        wb = Workbook(write_only=True)
        ws = wb.create_sheet()
        headers = ["short_id", "total_time_seconds", "tags", "agent_name", "date_with_time", "page_url", "response_time_seconds"]
        ws.append(headers)
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

    # Pageview aggregates: per-session first/last (for total_time) and
    # first pageview per conversation and per session (for page_url/date fallback).
    pv_q = db.query(
        ConversationPageView.session_id.label("session_id"),
        func.min(ConversationPageView.created_at).label("first_pv"),
        func.max(ConversationPageView.created_at).label("last_pv"),
    )
    if allowed_ids is not None:
        pv_q = pv_q.filter(ConversationPageView.website_id.in_(allowed_ids))
    pv_range = pv_q.group_by(ConversationPageView.session_id).subquery()

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

    # Main query selecting required columns
    q = (
        db.query(
            Conversation.short_id.label("short_id"),
            # Prefer pageview range when >0, otherwise fallback to last_seen - created_at
            func.coalesce(
                func.nullif((func.extract("epoch", pv_range.c.last_pv) - func.extract("epoch", pv_range.c.first_pv)), 0),
                (func.extract("epoch", Conversation.last_seen_at) - func.extract("epoch", Conversation.created_at)),
                0,
            ).label("total_time_seconds"),
            func.coalesce(tags_subq.c.tags, "").label("tags"),
            func.coalesce(assigned_user.name, msg_user.name, first_agent_msg.c.agent_sender).label("agent_name"),
            func.coalesce(first_pv.c.first_pv_at, first_pv_session.c.first_pv_at, Conversation.created_at).label("date_with_time"),
            func.coalesce(first_pv.c.url, first_pv_session.c.session_url).label("page_url"),
            (func.extract("epoch", first_agent_at.c.first_agent_at) - func.extract("epoch", Conversation.created_at)).label("response_time_seconds"),
        )
        .outerjoin(assigned_user, assigned_user.id == Conversation.assigned_agent_id)
        .outerjoin(first_agent_at, first_agent_at.c.conversation_id == Conversation.id)
        .outerjoin(first_agent_msg, first_agent_msg.c.conversation_id == Conversation.id)
        .outerjoin(msg_user, msg_user.email == first_agent_msg.c.agent_sender)
        .outerjoin(pv_range, pv_range.c.session_id == Conversation.session_id)
        .outerjoin(tags_subq, tags_subq.c.conversation_id == Conversation.id)
        .outerjoin(first_pv, first_pv.c.conversation_id == Conversation.id)
        .outerjoin(first_pv_session, first_pv_session.c.session_id == Conversation.session_id)
        .filter(Conversation.created_at >= start_dt, Conversation.created_at <= end_dt)
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

    # Create write-only workbook and stream rows
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title="Analytics")
    # Human-friendly column headers
    headers = [
        "Conversation ID",
        "Total Time",
        "Tags",
        "Agent Name",
        "Date & Time",
        "Page URL",
        "Response Time",
    ]
    ws.append(headers)

    # Iterate query in batches
    for row in q.yield_per(200):
        # Format Date & Time as: YYYY-MM-DD<spaces>HH:MM:SSAM/PM
        try:
            dt_val = row.date_with_time
            if dt_val is None:
                date_val = ""
            else:
                # If DB returned a string, try to parse ISO format first
                if isinstance(dt_val, str):
                    try:
                        dt_val = datetime.fromisoformat(dt_val)
                    except Exception:
                        pass
                # Ensure we have a datetime-like object
                try:
                    date_part = dt_val.date().isoformat()
                    time_part = dt_val.strftime('%I:%M:%S%p')
                    date_val = f"{date_part}      {time_part}"
                except Exception:
                    date_val = str(dt_val)
        except Exception:
            date_val = str(row.date_with_time) if row.date_with_time is not None else ""

        ws.append([
            row.short_id or "",
            float(row.total_time_seconds) if row.total_time_seconds is not None else 0,
            row.tags or "",
            row.agent_name or "",
            date_val,
            row.page_url or "",
            float(row.response_time_seconds) if row.response_time_seconds is not None else None,
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
    """Export full conversation transcripts as XLSX with one sheet per conversation."""
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

    # Load website names in batch
    website_ids_needed = {c.website_id for c in conversations}
    websites_map: dict[int, str] = {}
    if website_ids_needed:
        for w in db.query(Website).filter(Website.id.in_(website_ids_needed)).all():
            websites_map[w.id] = w.name

    # Load agent names in batch
    agent_ids_needed = {c.assigned_agent_id for c in conversations if c.assigned_agent_id}
    agents_map: dict[int, str] = {}
    if agent_ids_needed:
        for u in db.query(User).filter(User.id.in_(agent_ids_needed)).all():
            agents_map[u.id] = u.name or u.email

    # Build XLSX — one summary sheet + one sheet per conversation (up to 500)
    wb = Workbook(write_only=True)

    # Summary sheet
    summary_ws = wb.create_sheet("Summary")
    summary_ws.append([
        "Conversation ID", "Status", "Website", "Visitor Name", "Visitor Email",
        "Agent", "Started At", "Messages",
    ])
    for conv in conversations:
        summary_ws.append([
            conv.short_id or str(conv.id),
            conv.status.value if hasattr(conv.status, "value") else str(conv.status),
            websites_map.get(conv.website_id, f"Website {conv.website_id}"),
            conv.visitor_name or "",
            conv.visitor_email or "",
            agents_map.get(conv.assigned_agent_id, "") if conv.assigned_agent_id else "",
            conv.created_at.strftime("%Y-%m-%d %H:%M") if conv.created_at else "",
            0,  # will be filled in transcript sheet
        ])

    # One sheet per conversation (limit to first 200 for workbook size)
    for conv in conversations[:200]:
        msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.asc())
            .all()
        )
        sheet_title = (conv.short_id or str(conv.id))[:31]  # Excel sheet name limit
        ws = wb.create_sheet(sheet_title)
        # Header rows
        ws.append([f"Conversation: {conv.short_id or conv.id}"])
        ws.append([f"Visitor: {conv.visitor_name or conv.visitor_email or conv.session_id}"])
        ws.append([f"Status: {conv.status.value if hasattr(conv.status, 'value') else conv.status}"])
        ws.append([f"Started: {conv.created_at.strftime('%Y-%m-%d %H:%M') if conv.created_at else ''}"])
        ws.append([])
        ws.append(["Timestamp", "Sender", "Type", "Message"])
        for msg in msgs:
            sender = msg.sender or (msg.sender_type.value if hasattr(msg.sender_type, "value") else str(msg.sender_type))
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else ""
            event = msg.event_type or ""
            content = msg.content or ""
            ws.append([ts, sender, event, content])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    filename = f"transcripts_{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.xlsx"
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
