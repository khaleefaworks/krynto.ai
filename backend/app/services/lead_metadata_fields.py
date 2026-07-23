"""Catalog of standard, opt-in conversation metadata an admin can attach to
every lead a webhook integration sends — assigned agent, device/browser
info, tags, notes, browsing history, etc. Single source of truth for both
the picker UI (GET .../integrations/metadata-fields) and the resolver used
right before send (see lead_integration_service._enrich_payload_with_integration_metadata).

Each field is best-effort: a lookup failure (e.g. an FK pointing at a
deleted agent) must not blank the other selected fields or fail the send.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.conversation import Conversation


@dataclass(frozen=True)
class LeadMetadataField:
    id: str
    label: str
    description: str
    resolve: Callable[[Session, Conversation], Any]


def _resolve_agent(db: Session, conversation: Conversation) -> dict | None:
    if not conversation.assigned_agent_id:
        return None
    from app.models.user import User

    row = (
        db.query(User.name, User.email)
        .filter(User.id == conversation.assigned_agent_id)
        .first()
    )
    if not row:
        return None
    return {"name": row.name, "email": row.email}


def _resolve_agent_name(db: Session, conversation: Conversation) -> str | None:
    agent = _resolve_agent(db, conversation)
    return agent["name"] if agent else None


def _resolve_agent_email(db: Session, conversation: Conversation) -> str | None:
    agent = _resolve_agent(db, conversation)
    return agent["email"] if agent else None


def _resolve_team_name(db: Session, conversation: Conversation) -> str | None:
    if not conversation.team_id:
        return None
    from app.models.website_team import WebsiteTeam

    row = db.query(WebsiteTeam.name).filter(WebsiteTeam.id == conversation.team_id).first()
    return row.name if row else None


def _resolve_tags(db: Session, conversation: Conversation) -> list[dict]:
    conv_tags = getattr(conversation, "tags", None) or []
    result: list[dict] = []
    for ct in conv_tags:
        tag = getattr(ct, "tag", None)
        if not tag:
            continue
        result.append({"id": tag.id, "name": tag.name, "color": tag.color})
    return result


_NOTES_LIMIT = 20


def _resolve_notes(db: Session, conversation: Conversation) -> list[dict]:
    from app.models.conversation_note import ConversationNote
    from app.models.user import User

    notes = (
        db.query(ConversationNote)
        .filter(ConversationNote.conversation_id == conversation.id)
        .order_by(ConversationNote.created_at.desc())
        .limit(_NOTES_LIMIT)
        .all()
    )
    if not notes:
        return []
    author_ids = {n.created_by for n in notes if n.created_by}
    authors = {}
    if author_ids:
        authors = {
            u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_(author_ids)).all()
        }
    return [
        {
            "content": n.content,
            "created_by_name": authors.get(n.created_by),
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notes
    ]


_BROWSING_HISTORY_LIMIT = 20


def _resolve_browsing_history(db: Session, conversation: Conversation) -> list[dict]:
    from app.repos import page_views as page_views_repo

    rows = page_views_repo.list_page_views_for_conversation(
        db, conversation.id, limit=_BROWSING_HISTORY_LIMIT
    )
    if not rows:
        rows = page_views_repo.list_page_views_for_session(
            db, website_id=conversation.website_id, session_id=conversation.session_id,
            limit=_BROWSING_HISTORY_LIMIT,
        )
    return [
        {
            "title": r.title,
            "url": r.url,
            "referrer": r.referrer,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def _resolve_rating(db: Session, conversation: Conversation) -> dict | None:
    from app.models.conversation_rating import ConversationRating

    row = (
        db.query(ConversationRating)
        .filter(ConversationRating.conversation_id == conversation.id)
        .first()
    )
    if not row:
        return None
    return {"rating": row.rating, "feedback": row.feedback}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


LEAD_METADATA_FIELDS: list[LeadMetadataField] = [
    LeadMetadataField("agent_name", "Assigned agent name", "Name of the agent currently assigned to this conversation.", _resolve_agent_name),
    LeadMetadataField("agent_email", "Assigned agent email", "Email of the agent currently assigned to this conversation.", _resolve_agent_email),
    LeadMetadataField("device_info", "Device", "Visitor's device, e.g. \"Linux\", \"Windows 11\".", lambda db, c: c.device_info),
    LeadMetadataField("browser_info", "Browser", "Visitor's browser, e.g. \"Chrome 143\".", lambda db, c: c.browser_info),
    LeadMetadataField("visitor_ip", "Visitor IP", "IP address the visitor connected from.", lambda db, c: c.visitor_ip),
    LeadMetadataField("visit_count", "Visit count", "Number of times this visitor has visited.", lambda db, c: c.visit_count),
    LeadMetadataField("team_name", "Team", "Website team this conversation is routed to, if any.", _resolve_team_name),
    LeadMetadataField("tags", "Tags", "Tags applied to this conversation.", _resolve_tags),
    LeadMetadataField("notes", "Agent notes", "Private agent notes left on this conversation (most recent 20).", _resolve_notes),
    LeadMetadataField("browsing_history", "Browsing history", "Recent pages the visitor viewed (most recent 20).", _resolve_browsing_history),
    LeadMetadataField("rating", "Visitor rating/feedback", "The visitor's satisfaction rating and feedback, if given.", _resolve_rating),
    LeadMetadataField("resolved_at", "Resolved at", "When this conversation was marked resolved.", lambda db, c: _iso(c.resolved_at)),
    LeadMetadataField("closed_by", "Closed by", "How the conversation was closed: agent, visitor, or inactivity.", lambda db, c: c.closed_by),
]

_FIELDS_BY_ID: dict[str, LeadMetadataField] = {f.id: f for f in LEAD_METADATA_FIELDS}


def catalog() -> list[dict]:
    return [{"id": f.id, "label": f.label, "description": f.description} for f in LEAD_METADATA_FIELDS]


def is_valid_field_id(field_id: str) -> bool:
    return field_id in _FIELDS_BY_ID


def resolve_lead_metadata(db: Session, *, conversation_id: int | None, field_ids: list[str]) -> dict:
    """Resolve the requested subset of LEAD_METADATA_FIELDS for one
    conversation into a flat {field_id: value} dict. Unrecognized ids are
    silently skipped (forward/backward compat if a field is renamed after an
    integration already stored it referencing the old id). Returns {} if
    there's no conversation to resolve against, or nothing was requested."""
    if not conversation_id or not field_ids:
        return {}

    conversation = db.query(Conversation).filter_by(id=conversation_id).first()
    if not conversation:
        return {}

    result: dict[str, Any] = {}
    for field_id in field_ids:
        field = _FIELDS_BY_ID.get(field_id)
        if not field:
            continue
        try:
            value = field.resolve(db, conversation)
        except Exception:
            continue
        if value is not None:
            result[field_id] = value
    return result
