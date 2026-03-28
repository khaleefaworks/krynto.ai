from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import and_, case, func, literal, or_, tuple_
from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_page_view import ConversationPageView
from app.models.conversation_tag import ConversationTag
from app.models.tag import Tag
from app.models.user import User
from app.services.chat_service import ChatService
from app.core.avatar_colors import pick_avatar_color


def initiate_conversation_for_visitor(
    db: Session,
    *,
    website_id: int,
    session_id: str,
    agent_id: int,
) -> dict:
    """Create (or reuse) an open conversation for a visitor session.

    This supports agent-initiated chats even when the visitor hasn't sent a message yet.
    """

    website_id_int = int(website_id)
    session_id_str = str(session_id)
    agent_id_int = int(agent_id)

    # Reuse existing open conversation if present.
    existing = (
        db.query(Conversation)
        .filter_by(website_id=website_id_int, session_id=session_id_str, status=ConversationStatus.OPEN)
        .order_by(Conversation.created_at.desc())
        .first()
    )
    if existing:
        cid = int(existing.id)
        # Ensure agent assignment.
        try:
            if not getattr(existing, "visitor_avatar_color", None):
                existing.visitor_avatar_color = pick_avatar_color(session_id_str)
            if not getattr(existing, "assigned_agent_id", None):
                existing.assigned_agent_id = agent_id_int
                existing.is_handoff = True
                if getattr(existing, "last_agent_message_at", None) is None:
                    existing.last_agent_message_at = datetime.utcnow()
            if db.is_modified(existing):
                db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        try:
            ChatService.link_session_to_conversation(
                website_id=website_id_int,
                session_id=session_id_str,
                conversation_id=cid,
            )
        except Exception:
            pass
        return {"conversation_id": cid, "website_id": website_id_int, "session_id": session_id_str}

    # Create a new open conversation.
    conv = Conversation(
        website_id=website_id_int,
        session_id=session_id_str,
        status=ConversationStatus.OPEN,
        is_handoff=True,
        assigned_agent_id=agent_id_int,
        last_agent_message_at=datetime.utcnow(),
        visitor_avatar_color=pick_avatar_color(session_id_str),
    )

    db.add(conv)
    db.commit()
    db.refresh(conv)

    try:
        ChatService.link_session_to_conversation(
            website_id=website_id_int,
            session_id=session_id_str,
            conversation_id=int(conv.id),
        )
    except Exception:
        pass

    return {"conversation_id": int(conv.id), "website_id": website_id_int, "session_id": session_id_str}


@dataclass(frozen=True)
class VisitorRow:
    website_id: int
    session_id: str
    last_seen_at: datetime
    title: str | None
    url: str
    referrer: str | None
    visits: int
    chats: int


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _safe_hostname(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        parsed = urlparse(raw)
        return parsed.hostname or None
    except Exception:
        return None


def list_active_visitors(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    recently_left_within_seconds: int = 600,
    limit: int = 200,
) -> List[dict]:
    limit = max(1, min(500, int(limit)))

    recently_left_within_seconds = max(60, min(86400, int(recently_left_within_seconds)))
    now = _utcnow()
    cutoff = now - timedelta(seconds=recently_left_within_seconds)

    allowed_websites: set[int] | None = None
    if website_ids is not None:
        allowed_websites = {int(w) for w in website_ids}
        if website_id is not None:
            allowed_websites = allowed_websites.intersection({int(website_id)})
        if not allowed_websites:
            return []

    # 1) Prefer websocket presence (online + recently disconnected).
    presence = ChatService.session_presence_snapshot(
        website_id=website_id if website_id is not None else None,
        recently_left_within_seconds=recently_left_within_seconds,
    )
    presence_by_key: Dict[Tuple[int, str], dict] = {
        (int(r["website_id"]), str(r["session_id"])): r for r in presence
        if isinstance(r, dict) and ("website_id" in r) and ("session_id" in r)
    }

    if allowed_websites is not None:
        presence_by_key = {k: v for k, v in presence_by_key.items() if int(k[0]) in allowed_websites}

    keys: List[Tuple[int, str]] = list(presence_by_key.keys())

    # 2) Fallback: include recently seen sessions from page views (offline rows).
    rn_recent = func.row_number().over(
        partition_by=(ConversationPageView.website_id, ConversationPageView.session_id),
        order_by=ConversationPageView.created_at.desc(),
    ).label("rn")
    recent_q = (
        db.query(
            ConversationPageView.website_id.label("website_id"),
            ConversationPageView.session_id.label("session_id"),
            ConversationPageView.created_at.label("last_seen_at"),
            rn_recent,
        )
        .filter(ConversationPageView.created_at >= cutoff)
    )
    if website_id is not None:
        recent_q = recent_q.filter(ConversationPageView.website_id == int(website_id))
    elif allowed_websites is not None:
        recent_q = recent_q.filter(ConversationPageView.website_id.in_([int(w) for w in allowed_websites]))
    recent_subq = recent_q.subquery()
    recent_rows = (
        db.query(recent_subq)
        .filter(recent_subq.c.rn == 1)
        .order_by(recent_subq.c.last_seen_at.desc())
        .limit(limit)
        .all()
    )
    for r in recent_rows:
        k = (int(r.website_id), str(r.session_id))
        if k not in presence_by_key:
            keys.append(k)

    if not keys:
        return []

    # Keep stable ordering: online first, then latest disconnect/last_seen.
    def _k_rank(k: Tuple[int, str]) -> tuple:
        p = presence_by_key.get(k)
        if p and p.get("is_online"):
            ts = p.get("connected_at")
            ts_val = ts.timestamp() if isinstance(ts, datetime) else 0.0
            return (0, -ts_val)
        if p and p.get("last_disconnected_at"):
            ts = p.get("last_disconnected_at")
            ts_val = ts.timestamp() if isinstance(ts, datetime) else 0.0
            return (1, -ts_val)
        return (2, 0)

    keys = sorted(keys, key=_k_rank)[:limit]

    key_tuples = [(int(w), str(s)) for (w, s) in keys]

    visits_map: Dict[Tuple[int, str], int] = {}
    visits_rows = (
        db.query(
            ConversationPageView.website_id,
            ConversationPageView.session_id,
            func.count(ConversationPageView.id),
        )
        .filter(tuple_(ConversationPageView.website_id, ConversationPageView.session_id).in_(key_tuples))
        .group_by(ConversationPageView.website_id, ConversationPageView.session_id)
        .all()
    )
    for wid, sid, cnt in visits_rows:
        visits_map[(int(wid), str(sid))] = int(cnt or 0)

    chats_map: Dict[Tuple[int, str], int] = {}
    chat_rows = (
        db.query(Conversation.website_id, Conversation.session_id, func.count(Conversation.id))
        .filter(tuple_(Conversation.website_id, Conversation.session_id).in_(key_tuples))
        .group_by(Conversation.website_id, Conversation.session_id)
        .all()
    )
    for wid, sid, cnt in chat_rows:
        chats_map[(int(wid), str(sid))] = int(cnt or 0)

    # Conversation-derived flags for richer UI (visitor-initiated chat, agent joined, etc.)
    visitor_initiated_map: Dict[Tuple[int, str], bool] = {}
    # Only check the latest open conversation per visitor for the chat icon
    _vi_ranked = func.row_number().over(
        partition_by=(Conversation.website_id, Conversation.session_id),
        order_by=Conversation.created_at.desc(),
    ).label("rn")
    _vi_subq = (
        db.query(
            Conversation.website_id.label("website_id"),
            Conversation.session_id.label("session_id"),
            case((Conversation.last_visitor_message_at.isnot(None), 1), else_=0).label("has_visitor_msg"),
            _vi_ranked,
        )
        .filter(
            tuple_(Conversation.website_id, Conversation.session_id).in_(key_tuples),
            Conversation.status == ConversationStatus.OPEN,
        )
        .subquery()
    )
    initiated_rows = (
        db.query(
            _vi_subq.c.website_id,
            _vi_subq.c.session_id,
            _vi_subq.c.has_visitor_msg,
        )
        .filter(_vi_subq.c.rn == 1)
        .all()
    )
    for wid, sid, flag in initiated_rows:
        visitor_initiated_map[(int(wid), str(sid))] = bool(int(flag or 0))

    latest_conv_rank = func.row_number().over(
        partition_by=(Conversation.website_id, Conversation.session_id),
        order_by=Conversation.created_at.desc(),
    ).label("rn")
    latest_conv_subq = (
        db.query(
            Conversation.website_id.label("website_id"),
            Conversation.session_id.label("session_id"),
            Conversation.id.label("conversation_id"),
            Conversation.assigned_agent_id.label("assigned_agent_id"),
            Conversation.visitor_avatar_color.label("visitor_avatar_color"),
            Conversation.visitor_name.label("visitor_name"),
            Conversation.visitor_email.label("visitor_email"),
            Conversation.visitor_phone.label("visitor_phone"),
            latest_conv_rank,
        )
        .filter(tuple_(Conversation.website_id, Conversation.session_id).in_(key_tuples))
        .subquery()
    )
    latest_conv_rows = db.query(latest_conv_subq).filter(latest_conv_subq.c.rn == 1).all()
    latest_conv_by_key: Dict[Tuple[int, str], dict] = {}
    assigned_agent_ids: set[int] = set()
    for r in latest_conv_rows:
        k = (int(r.website_id), str(r.session_id))
        assigned_id = int(r.assigned_agent_id) if r.assigned_agent_id is not None else None
        latest_conv_by_key[k] = {
            "conversation_id": int(r.conversation_id) if r.conversation_id is not None else None,
            "assigned_agent_id": assigned_id,
            "visitor_avatar_color": getattr(r, "visitor_avatar_color", None),
            "visitor_name": getattr(r, "visitor_name", None),
            "visitor_email": getattr(r, "visitor_email", None),
            "visitor_phone": getattr(r, "visitor_phone", None),
        }
        if assigned_id is not None:
            assigned_agent_ids.add(int(assigned_id))

    agent_by_id: Dict[int, dict] = {}
    if assigned_agent_ids:
        agent_rows = (
            db.query(User.id, User.name, User.avatar_url)
            .filter(User.id.in_(list(assigned_agent_ids)))
            .all()
        )
        for uid, name, avatar_url in agent_rows:
            agent_by_id[int(uid)] = {
                "id": int(uid),
                "name": str(name) if name is not None else None,
                "avatar_url": str(avatar_url) if avatar_url is not None else None,
            }

    # Latest page view per session for current page + referrer.
    rn_latest = func.row_number().over(
        partition_by=(ConversationPageView.website_id, ConversationPageView.session_id),
        order_by=ConversationPageView.created_at.desc(),
    ).label("rn")
    latest_q = (
        db.query(
            ConversationPageView.website_id.label("website_id"),
            ConversationPageView.session_id.label("session_id"),
            ConversationPageView.created_at.label("last_seen_at"),
            ConversationPageView.title.label("title"),
            ConversationPageView.url.label("url"),
            ConversationPageView.referrer.label("referrer"),
            rn_latest,
        )
        .filter(tuple_(ConversationPageView.website_id, ConversationPageView.session_id).in_(key_tuples))
    )
    latest_subq = latest_q.subquery()
    latest_rows = db.query(latest_subq).filter(latest_subq.c.rn == 1).all()

    latest_by_key: Dict[Tuple[int, str], dict] = {}
    for r in latest_rows:
        last_seen = r.last_seen_at
        if last_seen is not None and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        latest_by_key[(int(r.website_id), str(r.session_id))] = {
            "last_seen_at": last_seen,
            "title": r.title,
            "url": r.url,
            "referrer": r.referrer,
        }

    result: List[dict] = []
    for (wid, sid) in keys:
        p = presence_by_key.get((wid, sid))
        is_online = bool(p and p.get("is_online"))

        connected_at = p.get("connected_at") if isinstance(p, dict) else None
        last_disconnected_at = p.get("last_disconnected_at") if isinstance(p, dict) else None

        last_seen = latest_by_key.get((wid, sid), {}).get("last_seen_at")
        if isinstance(last_seen, datetime) and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)

        online_seconds: int | None = None
        if is_online and isinstance(connected_at, datetime):
            online_seconds = max(0, int((now - connected_at).total_seconds()))
        elif (not is_online) and isinstance(last_disconnected_at, datetime):
            online_seconds = max(0, int((now - last_disconnected_at).total_seconds()))
        elif isinstance(last_seen, datetime):
            online_seconds = max(0, int((now - last_seen).total_seconds()))

        latest_info = latest_by_key.get((wid, sid), {})
        url = latest_info.get("url") or ""

        latest_conv = latest_conv_by_key.get((wid, sid), {})
        assigned_id = latest_conv.get("assigned_agent_id")
        assigned_agent = agent_by_id.get(int(assigned_id)) if assigned_id is not None else None
        visitor_avatar_color = latest_conv.get("visitor_avatar_color") or pick_avatar_color(str(sid))

        result.append(
            {
                "website_id": int(wid),
                "session_id": str(sid),
                "is_online": is_online,
                "online_seconds": online_seconds,
                "latest_conversation_id": latest_conv.get("conversation_id"),
                "visitor_initiated_chat": bool(visitor_initiated_map.get((wid, sid), False)),
                "agent_joined": bool(assigned_id is not None),
                "assigned_agent": assigned_agent,
                "visitor_name": latest_conv.get("visitor_name"),
                "visitor_email": latest_conv.get("visitor_email"),
                "visitor_phone": latest_conv.get("visitor_phone"),
                "visitor_avatar_color": visitor_avatar_color,
                "current_page": {
                    "title": latest_info.get("title"),
                    "url": url,
                },
                "came_from": _safe_hostname(latest_info.get("referrer")),
                "visits": visits_map.get((wid, sid), 0),
                "chats": chats_map.get((wid, sid), 0),
                "last_seen_at": last_seen.isoformat() if isinstance(last_seen, datetime) else None,
            }
        )

    return result


def get_visitor_details(
    db: Session,
    *,
    website_id: int,
    session_id: str,
    team_ids: list[int] | None = None,
    recently_left_within_seconds: int = 600,
    page_view_limit: int = 50,
) -> dict:
    website_id_int = int(website_id)
    session_id_str = str(session_id)

    presence = ChatService.session_presence_snapshot(
        website_id=website_id_int,
        recently_left_within_seconds=recently_left_within_seconds,
    )
    p = None
    for r in presence:
        if int(r.get("website_id")) == website_id_int and str(r.get("session_id")) == session_id_str:
            p = r
            break

    now = _utcnow()
    is_online = bool(p and p.get("is_online"))
    connected_at = p.get("connected_at") if isinstance(p, dict) else None
    last_disconnected_at = p.get("last_disconnected_at") if isinstance(p, dict) else None

    # Latest page view info + device/browser snapshot.
    latest = (
        db.query(ConversationPageView)
        .filter_by(website_id=website_id_int, session_id=session_id_str)
        .order_by(ConversationPageView.created_at.desc())
        .first()
    )

    def _as_utc(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    last_seen_at = _as_utc(getattr(latest, "created_at", None))
    online_seconds: int | None = None
    if is_online and isinstance(connected_at, datetime):
        online_seconds = max(0, int((now - connected_at).total_seconds()))
    elif (not is_online) and isinstance(last_disconnected_at, datetime):
        online_seconds = max(0, int((now - last_disconnected_at).total_seconds()))
    elif isinstance(last_seen_at, datetime):
        online_seconds = max(0, int((now - last_seen_at).total_seconds()))

    visits = (
        db.query(func.count(ConversationPageView.id))
        .filter_by(website_id=website_id_int, session_id=session_id_str)
        .scalar()
    )
    visits_int = int(visits or 0)

    conv_q = (
        db.query(Conversation)
        .filter_by(website_id=website_id_int, session_id=session_id_str)
        .order_by(Conversation.created_at.desc())
    )
    if team_ids is not None:
        team_ids_norm = [int(t) for t in team_ids]
        if not team_ids_norm:
            conv_q = conv_q.filter(literal(False))
        else:
            conv_q = conv_q.filter(Conversation.team_id.in_(team_ids_norm))

    conversations = conv_q.all()

    visitor_avatar_color = None
    if conversations:
        visitor_avatar_color = getattr(conversations[0], "visitor_avatar_color", None)
    if not visitor_avatar_color:
        visitor_avatar_color = pick_avatar_color(session_id_str)

    visitor_name = getattr(conversations[0], "visitor_name", None) if conversations else None
    visitor_email = getattr(conversations[0], "visitor_email", None) if conversations else None
    visitor_phone = getattr(conversations[0], "visitor_phone", None) if conversations else None

    # Check only the latest open conversation for visitor-initiated chat
    open_convs = [c for c in conversations if (c.status.value if hasattr(c.status, "value") else c.status) == "open"]
    latest_open = open_convs[0] if open_convs else None
    visitor_initiated_chat = getattr(latest_open, "last_visitor_message_at", None) is not None if latest_open else False

    latest_assigned_agent = None
    if conversations:
        assigned_id = getattr(conversations[0], "assigned_agent_id", None)
        if assigned_id is not None:
            try:
                u = db.query(User).filter_by(id=int(assigned_id)).first()
                if u:
                    latest_assigned_agent = {
                        "id": int(u.id),
                        "name": str(u.name) if u.name is not None else None,
                        "avatar_url": str(u.avatar_url) if u.avatar_url is not None else None,
                    }
            except Exception:
                latest_assigned_agent = None

    conv_rows = [
        {
            "conversation_id": int(c.id),
            "short_id": str(c.short_id) if getattr(c, "short_id", None) else None,
            "session_id": str(c.session_id),
            "title": getattr(c, "title", None),
            "status": str(c.status.value if hasattr(c.status, "value") else c.status),
            "has_visitor_message": getattr(c, "last_visitor_message_at", None) is not None,
            "created_at": _as_utc(c.created_at).isoformat() if _as_utc(c.created_at) else None,
        }
        for c in conversations
    ]

    page_views = (
        db.query(ConversationPageView)
        .filter_by(website_id=website_id_int, session_id=session_id_str)
        .order_by(ConversationPageView.created_at.desc())
        .limit(max(1, min(200, int(page_view_limit))))
        .all()
    )

    page_view_rows = [
        {
            "title": pv.title,
            "url": pv.url,
            "referrer": pv.referrer,
            "created_at": _as_utc(pv.created_at).isoformat() if _as_utc(pv.created_at) else None,
        }
        for pv in page_views
    ]

    current_page = None
    if latest and getattr(latest, "url", None):
        current_page = {"title": getattr(latest, "title", None), "url": str(latest.url)}

    return {
        "website_id": website_id_int,
        "session_id": session_id_str,
        "is_online": is_online,
        "online_seconds": online_seconds,
        "visitor_name": visitor_name,
        "visitor_email": visitor_email,
        "visitor_phone": visitor_phone,
        "visitor_avatar_color": visitor_avatar_color,
        "visitor_initiated_chat": bool(visitor_initiated_chat),
        "agent_joined": bool(latest_assigned_agent is not None),
        "assigned_agent": latest_assigned_agent,
        "visits": visits_int,
        "chats": len(conversations),
        "came_from": _safe_hostname(getattr(latest, "referrer", None) if latest else None),
        "current_page": current_page,
        "device_info": getattr(latest, "device_info", None) if latest else None,
        "browser_info": getattr(latest, "browser_info", None) if latest else None,
        "last_seen_at": last_seen_at.isoformat() if isinstance(last_seen_at, datetime) else None,
        "page_views": page_view_rows,
        "conversations": conv_rows,
    }


def get_contact_details(
    db: Session,
    *,
    website_id: int | None,
    website_ids: list[int] | None = None,
    contact_key: str,
    team_ids: list[int] | None = None,
) -> dict:
    contact_key_str = str(contact_key)

    q = db.query(Conversation).filter(
        or_(Conversation.visitor_email == contact_key_str, Conversation.visitor_phone == contact_key_str)
    )
    if website_id is not None:
        q = q.filter(Conversation.website_id == int(website_id))
    if website_ids is not None:
        website_ids_norm = [int(w) for w in website_ids]
        if not website_ids_norm:
            return {
                "contact_key": contact_key_str,
                "website_id": int(website_id) if website_id is not None else None,
                "name": None,
                "email": None,
                "phone": None,
                "visits": 0,
                "chats": 0,
                "conversations": [],
                "tags": [],
                "last_update": None,
            }
        q = q.filter(Conversation.website_id.in_(website_ids_norm))

    if team_ids is not None:
        team_ids_norm = [int(t) for t in team_ids]
        if not team_ids_norm:
            q = q.filter(literal(False))
        else:
            q = q.filter(Conversation.team_id.in_(team_ids_norm))

    conversations = q.order_by(Conversation.created_at.desc()).all()
    if not conversations:
        return {
            "contact_key": contact_key_str,
            "website_id": int(website_id) if website_id is not None else None,
            "name": None,
            "email": None,
            "phone": None,
            "visits": 0,
            "chats": 0,
            "conversations": [],
            "tags": [],
            "last_update": None,
        }

    latest = conversations[0]
    last_update = latest.updated_at or latest.created_at
    if last_update is not None and getattr(last_update, "tzinfo", None) is None:
        last_update = last_update.replace(tzinfo=timezone.utc)

    visits_sum = 0
    for c in conversations:
        try:
            visits_sum += int(c.visit_count or 0)
        except Exception:
            pass

    conv_ids = [int(c.id) for c in conversations]
    tags_rows = (
        db.query(ConversationTag.conversation_id, Tag.name, Tag.color)
        .join(Tag, Tag.id == ConversationTag.tag_id)
        .filter(ConversationTag.conversation_id.in_(conv_ids))
        .all()
    )
    tags: Dict[str, dict] = {}
    for _cid, name, color in tags_rows:
        if name not in tags:
            tags[name] = {"name": name, "color": color}

    conv_rows = []
    for c in conversations:
        created_at = c.created_at
        if created_at is not None and getattr(created_at, "tzinfo", None) is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        conv_rows.append(
            {
                "conversation_id": int(c.id),
                "short_id": str(c.short_id) if getattr(c, "short_id", None) else None,
                "session_id": str(c.session_id),
                "title": getattr(c, "title", None),
                "status": str(c.status.value if hasattr(c.status, "value") else c.status),
                "created_at": created_at.isoformat() if created_at is not None else None,
            }
        )

    return {
        "contact_key": contact_key_str,
        "website_id": int(latest.website_id),
        "name": latest.visitor_name,
        "email": latest.visitor_email,
        "phone": latest.visitor_phone,
        "visitor_avatar_color": getattr(latest, "visitor_avatar_color", None),
        "visits": int(visits_sum),
        "chats": int(len(conversations)),
        "conversations": conv_rows,
        "tags": list(tags.values()),
        "last_update": last_update.isoformat() if last_update is not None else None,
    }


def list_contacts(
    db: Session,
    *,
    website_id: int | None = None,
    website_ids: list[int] | None = None,
    limit: int = 200,
) -> List[dict]:
    limit = max(1, min(500, int(limit)))

    contact_key = func.coalesce(Conversation.visitor_email, Conversation.visitor_phone).label("contact_key")
    last_update = func.coalesce(Conversation.updated_at, Conversation.created_at)
    rn = func.row_number().over(
        partition_by=(Conversation.website_id, contact_key),
        order_by=last_update.desc(),
    ).label("rn")

    q = (
        db.query(
            Conversation.id.label("conversation_id"),
            Conversation.website_id.label("website_id"),
            contact_key,
            Conversation.visitor_name.label("visitor_name"),
            Conversation.visitor_email.label("visitor_email"),
            Conversation.visitor_phone.label("visitor_phone"),
            Conversation.visitor_avatar_color.label("visitor_avatar_color"),
            last_update.label("last_update"),
            rn,
        )
        .filter(func.coalesce(Conversation.visitor_email, Conversation.visitor_phone).isnot(None))
    )
    if website_id is not None:
        q = q.filter(Conversation.website_id == int(website_id))
    if website_ids is not None:
        website_ids_norm = [int(w) for w in website_ids]
        if not website_ids_norm:
            return []
        q = q.filter(Conversation.website_id.in_(website_ids_norm))

    latest_subq = q.subquery()

    latest = (
        db.query(latest_subq)
        .filter(latest_subq.c.rn == 1)
        .order_by(latest_subq.c.last_update.desc())
        .limit(limit)
        .all()
    )
    if not latest:
        return []

    conv_ids = [int(r.conversation_id) for r in latest]
    tags_rows = (
        db.query(ConversationTag.conversation_id, Tag.name, Tag.color)
        .join(Tag, Tag.id == ConversationTag.tag_id)
        .filter(ConversationTag.conversation_id.in_(conv_ids))
        .all()
    )
    tags_map: Dict[int, List[dict]] = {}
    for conv_id, name, color in tags_rows:
        tags_map.setdefault(int(conv_id), []).append({"name": name, "color": color})

    result: List[dict] = []
    for r in latest:
        last_up = r.last_update
        if last_up is not None and getattr(last_up, "tzinfo", None) is None:
            last_up = last_up.replace(tzinfo=timezone.utc)

        result.append(
            {
                "contact_key": str(r.contact_key),
                "website_id": int(r.website_id),
                "name": r.visitor_name,
                "email": r.visitor_email,
                "phone": r.visitor_phone,
                "visitor_avatar_color": getattr(r, "visitor_avatar_color", None),
                "last_update": last_up.isoformat() if last_up is not None else None,
                "tags": tags_map.get(int(r.conversation_id), []),
            }
        )
    return result
