from fastapi import APIRouter, Depends, HTTPException
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.conversation_service import ConversationService
from app.api.deps import require_authenticated_user
from app.models.user import User
from pydantic import BaseModel
from typing import List, Optional

from app.core.message_presenter import serialize_message
from app.repos import conversations as conversations_repo
from app.repos import conversation_reads as conversation_reads_repo
from app.models.message import Message, MessageSenderType
from app.models.website import Website
from app.models.conversation import Conversation
from app.services.visibility import compute_visibility_scope

router = APIRouter(prefix="/chats", tags=["chats"])


def _ensure_conversation_visible(db: Session, *, current_user: User, conv) -> None:
    scope = compute_visibility_scope(db, user=current_user)

    if scope.organization_id is not None:
        conv_website_id = getattr(conv, "website_id", None)
        if conv_website_id is not None:
            w = db.query(Website.organization_id).filter(Website.id == conv_website_id).first()
            if w is None or w[0] != scope.organization_id:
                raise HTTPException(status_code=403, detail="Chat not available")

    if scope.website_ids is not None:
        if int(getattr(conv, "website_id", 0)) not in set(scope.website_ids):
            raise HTTPException(status_code=403, detail="Chat not available")

    if scope.team_ids is not None:
        tid = getattr(conv, "team_id", None)
        if tid is None or int(tid) not in set(scope.team_ids):
            raise HTTPException(status_code=403, detail="Chat not available")


def _safe_serialize_conversation_tags(conv) -> list[dict]:
    """Best-effort tag serialization.

    This endpoint is used by the agent dashboard. If the DB schema is
    temporarily out of sync (e.g. tag refactor in progress), we prefer to
    return an empty list rather than raising and causing a 500.
    """

    try:
        conv_tags = getattr(conv, "tags", None)
        if not conv_tags:
            return []

        result: list[dict] = []
        for ct in conv_tags:
            tag = getattr(ct, "tag", None)
            if not tag:
                continue
            result.append(
                {
                    "id": tag.id,
                    "name": tag.name,
                    "color": tag.color,
                }
            )
        return result
    except Exception:
        return []


class ConversationResponse(BaseModel):
    id: int
    website_id: int
    session_id: str
    status: str
    is_handoff: bool
    assigned_agent_id: Optional[int]
    message_count: int
    
    class Config:
        from_attributes = True


def _resolve_conversation(db: Session, chat_id: str) -> Conversation:
    """Resolve a conversation from a path param that may be an integer PK or a short_id string."""
    # Try integer PK first (backward compat)
    try:
        pk = int(chat_id)
        conv = conversations_repo.get_conversation_by_id(db, pk)
        if conv:
            return conv
    except (ValueError, TypeError):
        pass
    # Fall back to short_id lookup
    conv = conversations_repo.get_conversation_by_short_id(db, chat_id)
    if conv:
        return conv
    raise HTTPException(status_code=404, detail="Conversation not found")


@router.post("/{chat_id}/join")
async def join_chat(
    chat_id: str,
    _request: Optional[dict] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Agent joins a chat - triggers handoff"""
    from app.models.conversation import Conversation
    
    orchestrator = ConversationOrchestrator(db)

    conv = _resolve_conversation(db, chat_id)
    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    result = await orchestrator.handle_agent_join(
        conversation_id=conv.id,
        agent_id=current_user.id,
    )

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return {
        "success": True,
        "conversation_id": conv.id,
        "website_id": conv.website_id,
        "assigned_agent_id": current_user.id,
        "message": "Chat successfully assigned to agent",
        "message_obj": result.get("message_obj"),
        "message_id": result.get("message_id"),
            "agent_is_available": result.get("agent_is_available"),
        "availability_changed": result.get("availability_changed"),
    }


@router.get("/active")
def get_active_chats(
    website_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Get list of active chats available for agent pickup"""
    scope = compute_visibility_scope(db, user=current_user)

    if scope.website_ids is not None and not scope.website_ids:
        return []

    if website_id is not None and scope.website_ids is not None:
        if int(website_id) not in set(scope.website_ids):
            return []

    rows = conversations_repo.active_conversations_with_counts_and_last_message(
        db,
        website_id=website_id,
        website_ids=None if (website_id is not None or scope.website_ids is None) else scope.website_ids,
        team_ids=scope.team_ids,
    )

    conversation_ids: list[int] = [int(conv.id) for conv, *_rest in rows]
    unread_counts = conversation_reads_repo.unread_counts_for_conversation_ids(
        db, user_id=current_user.id, conversation_ids=conversation_ids
    )

    # Batch-fetch visitor_ended flag directly from the Conversation model column.
    visitor_ended_ids: set[int] = set()
    if conversation_ids:
        from app.models.conversation import Conversation as Conv
        visitor_ended_ids = {
            int(row[0])
            for row in db.query(Conv.id)
            .filter(
                Conv.id.in_(conversation_ids),
                Conv.visitor_ended == True,  # noqa: E712
            )
            .all()
        }

    result = []
    for conv, website_name, message_count, last_message, last_message_at in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages yet"
        result.append(
            {
                "id": conv.id,
                "short_id": conv.short_id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "team_id": getattr(conv, "team_id", None),
                "visitor_name": conv.visitor_name,
                "visitor_email": conv.visitor_email,
                "visitor_phone": conv.visitor_phone,
                "device_info": conv.device_info,
                "browser_info": conv.browser_info,
                "visitor_ip": getattr(conv, "visitor_ip", None),
                "visitor_avatar_color": getattr(conv, "visitor_avatar_color", None),
                "visit_count": int(conv.visit_count or 0) if hasattr(conv, "visit_count") else None,
                "last_seen_at": conv.last_seen_at.isoformat() if getattr(conv, "last_seen_at", None) else None,
                "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
                "is_handoff": conv.is_handoff if conv.is_handoff is not None else False,
                "assigned_agent_id": conv.assigned_agent_id,
                "closed_by": getattr(conv, "closed_by", None),
                "visitor_ended": int(conv.id) in visitor_ended_ids,
                "message_count": int(message_count or 0),
                # Only surface unread count for the assigned agent (or when
                # unassigned — i.e. open for pickup). Spectating agents should
                # not accumulate badge noise for conversations they don't own.
                "unread_count": int(unread_counts.get(int(conv.id), 0))
                if (
                    conv.assigned_agent_id is None
                    or int(conv.assigned_agent_id) == int(current_user.id)
                )
                else 0,
                "last_message": last_message_val,
                "last_message_at": last_message_at.isoformat() if last_message_at else None,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "tags": _safe_serialize_conversation_tags(conv),
            }
        )

    return result


@router.get("/{chat_id}")
def get_chat_summary(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Get a single conversation summary by id.

    This is used for deep-linking from Customers pages, even when the conversation
    is hidden from the active inbox list (e.g. welcome-only/system-only cases).
    """

    conv = _resolve_conversation(db, chat_id)

    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    website = db.query(Website).filter_by(id=conv.website_id).first()
    website_name = (website.name if website else None) or f"Website {conv.website_id}"

    return {
        "id": int(conv.id),
        "short_id": conv.short_id,
        "website_id": int(conv.website_id),
        "website_name": website_name,
        "session_id": str(conv.session_id),
        "team_id": getattr(conv, "team_id", None),
        "visitor_name": getattr(conv, "visitor_name", None),
        "visitor_email": getattr(conv, "visitor_email", None),
        "visitor_phone": getattr(conv, "visitor_phone", None),
        "device_info": getattr(conv, "device_info", None),
        "browser_info": getattr(conv, "browser_info", None),
        "visitor_ip": getattr(conv, "visitor_ip", None),
        "visitor_avatar_color": getattr(conv, "visitor_avatar_color", None),
        "visit_count": int(getattr(conv, "visit_count", 0) or 0) if hasattr(conv, "visit_count") else None,
        "last_seen_at": conv.last_seen_at.isoformat() if getattr(conv, "last_seen_at", None) else None,
        "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
        "is_handoff": bool(getattr(conv, "is_handoff", False)),
        "assigned_agent_id": getattr(conv, "assigned_agent_id", None),
        "closed_by": getattr(conv, "closed_by", None),
        "visitor_ended": bool(getattr(conv, "visitor_ended", False)),
        "title": getattr(conv, "title", None),
        "message_count": 0,
        "unread_count": 0,
        "last_message": None,
        "last_message_at": None,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "closed_at": conv.updated_at.isoformat() if getattr(conv, "updated_at", None) else None,
        "tags": _safe_serialize_conversation_tags(conv),
    }


@router.get("/{chat_id}/messages")
def get_chat_messages(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Get all messages in a conversation"""
    conv = _resolve_conversation(db, chat_id)

    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    agent_service = AgentService(db)
    messages = agent_service.get_conversation_messages(conv.id)
    
    if not messages:
        # Return empty array if conversation exists but no messages
        return []
    
    result = []
    for msg in messages:
        result.append(serialize_message(db, msg))

    return result


@router.get("/resolved/history")
def get_resolved_conversations(
    website_id: Optional[int] = None,
    agent_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Get resolved conversation history with filters"""
    scope = compute_visibility_scope(db, user=current_user)

    if scope.website_ids is not None and not scope.website_ids:
        return []

    if website_id is not None and scope.website_ids is not None:
        if int(website_id) not in set(scope.website_ids):
            return []

    rows = conversations_repo.resolved_conversations_with_counts_and_last_message(
        db,
        website_id=website_id,
        website_ids=None if (website_id is not None or scope.website_ids is None) else scope.website_ids,
        team_ids=scope.team_ids,
        agent_id=agent_id,
        limit=limit,
    )

    result = []
    for conv, website_name, message_count, last_message, last_message_at in rows:
        website_name_val = website_name or f"Website {conv.website_id}"
        last_message_val = last_message if last_message is not None else "No messages"
        result.append(
            {
                "id": conv.id,
                "short_id": conv.short_id,
                "website_id": conv.website_id,
                "website_name": website_name_val,
                "session_id": conv.session_id,
                "team_id": getattr(conv, "team_id", None),
                "visitor_name": conv.visitor_name,
                "visitor_email": conv.visitor_email,
                "visitor_phone": conv.visitor_phone,
                "device_info": conv.device_info,
                "browser_info": conv.browser_info,
                "visitor_ip": getattr(conv, "visitor_ip", None),
                "visitor_avatar_color": getattr(conv, "visitor_avatar_color", None),
                "visit_count": int(conv.visit_count or 0) if hasattr(conv, "visit_count") else None,
                "last_seen_at": conv.last_seen_at.isoformat() if getattr(conv, "last_seen_at", None) else None,
                "status": conv.status.value if hasattr(conv.status, "value") else conv.status,
                "assigned_agent_id": conv.assigned_agent_id,
                "closed_by": getattr(conv, "closed_by", None),
                "title": getattr(conv, "title", None),
                "message_count": int(message_count or 0),
                "unread_count": 0,
                "last_message": last_message_val,
                "last_message_at": last_message_at.isoformat() if last_message_at else None,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "closed_at": conv.updated_at.isoformat() if conv.updated_at else None,
                "tags": _safe_serialize_conversation_tags(conv),
            }
        )

    return result


@router.post("/{conversation_id}/close")
async def close_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """
    Resolve a conversation.
    
    Transitions conversation to RESOLVED state.
    No more messages can be added after resolving.
    """
    conv = _resolve_conversation(db, conversation_id)
    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    # Guard: refuse to resolve conversations where the visitor never sent a message.
    # This prevents agents from bulk-closing bot-only / zero-interaction conversations.
    prior_visitor_msg_count = (
        db.query(Message)
        .filter(
            Message.conversation_id == conv.id,
            Message.sender_type == MessageSenderType.VISITOR,
        )
        .count()
    )
    if prior_visitor_msg_count == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot resolve a conversation with no visitor messages",
        )

    orchestrator = ConversationOrchestrator(db)

    result = await orchestrator.close_conversation(
        conversation_id=conv.id,
        agent_name=getattr(current_user, 'name', None) or 'Support',
    )

    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])

    return {
        "success": True,
        "conversation_id": conv.id,
        "message": "Conversation resolved successfully",
    }


@router.get("/{chat_id}/visitor-history")
def get_visitor_history(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Return all other conversations from the same visitor (session_id + website_id), excluding the current one."""
    conv = _resolve_conversation(db, chat_id)
    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    others = (
        db.query(Conversation)
        .filter(
            Conversation.session_id == conv.session_id,
            Conversation.website_id == conv.website_id,
            Conversation.id != conv.id,
        )
        .order_by(Conversation.created_at.desc())
        .limit(20)
        .all()
    )

    result = []
    for c in others:
        result.append(
            {
                "id": c.id,
                "short_id": c.short_id,
                "status": c.status.value if hasattr(c.status, "value") else c.status,
                "title": getattr(c, "title", None),
                "closed_by": getattr(c, "closed_by", None),
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "last_visitor_message_at": c.last_visitor_message_at.isoformat() if getattr(c, "last_visitor_message_at", None) else None,
            }
        )

    return result


@router.post("/{chat_id}/read")
async def mark_chat_read(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Mark a chat as read for the current user."""

    conv = _resolve_conversation(db, chat_id)

    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    conversation_reads_repo.mark_conversation_read(
        db,
        conversation_id=conv.id,
        user_id=current_user.id,
    )
    db.commit()

    # Best-effort: tell the agent UI (and any other tabs) to clear unread.
    try:
        await AgentService(db).send_to_agent(
            current_user.id,
            {
                "type": "conversation_unread",
                "conversation_id": conv.id,
                "website_id": conv.website_id,
                "unread_count": 0,
            },
        )
    except Exception:
        pass

    return {"success": True, "conversation_id": conv.id}


@router.get("/{chat_id}/read-state")
def get_chat_read_state(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Return read state for placing an unread separator in the thread UI."""

    conv = _resolve_conversation(db, chat_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    try:
        from app.models.conversation_read import ConversationRead

        row = (
            db.query(ConversationRead)
            .filter(ConversationRead.conversation_id == conv.id, ConversationRead.user_id == current_user.id)
            .first()
        )
        last_read_at = row.last_read_at if row else None
    except Exception:
        last_read_at = None

    # Find the earliest unread VISITOR message after last_read_at.
    first_unread_message_id = None
    try:
        q = db.query(Message).filter(Message.conversation_id == conv.id, Message.sender_type == MessageSenderType.VISITOR)
        if last_read_at is not None:
            q = q.filter(Message.created_at > last_read_at)
        first_unread = q.order_by(Message.created_at.asc(), Message.id.asc()).first()
        first_unread_message_id = int(first_unread.id) if first_unread else None
    except Exception:
        first_unread_message_id = None

    return {
        "conversation_id": conv.id,
        "last_read_at": last_read_at.isoformat() if last_read_at else None,
        "first_unread_message_id": first_unread_message_id,
    }


@router.get("/{chat_id}/form-submissions")
def get_conversation_form_submissions(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Return all form submissions linked to this conversation."""
    conv = _resolve_conversation(db, chat_id)
    _ensure_conversation_visible(db, current_user=current_user, conv=conv)

    from app.repos import forms as forms_repo
    from app.models.website_form import WebsiteForm

    subs = forms_repo.get_submissions_by_conversation(db, conv.id)
    result = []
    for sub in subs:
        form = db.query(WebsiteForm).filter(WebsiteForm.id == sub.form_id).first()
        result.append({
            "id": sub.id,
            "form_id": sub.form_id,
            "form_name": form.name if form else None,
            "form_fields": form.fields if form else [],
            "data": sub.data,
            "created_at": sub.created_at.isoformat() if sub.created_at else None,
        })
    return result
