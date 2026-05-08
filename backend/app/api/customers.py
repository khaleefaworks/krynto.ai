from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_agent
from app.core.database import get_db
from app.models.user import User
from app.repos import customers as customers_repo
from app.services.visibility import compute_visibility_scope


router = APIRouter(prefix="/customers", tags=["customers"])


class CurrentPage(BaseModel):
    title: str | None = None
    url: str


class VisitorResponse(BaseModel):
    website_id: int
    session_id: str
    is_online: bool
    online_seconds: int | None = None
    latest_conversation_id: int | None = None
    visitor_initiated_chat: bool = False
    agent_joined: bool = False
    assigned_agent: Dict[str, Any] | None = None
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None
    visitor_avatar_color: str | None = None
    current_page: CurrentPage
    came_from: str | None = None
    visits: int
    chats: int
    last_seen_at: str | None = None


class VisitorDetailsResponse(BaseModel):
    website_id: int
    session_id: str
    is_online: bool
    online_seconds: int | None = None
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None
    visitor_avatar_color: str | None = None
    visitor_initiated_chat: bool = False
    agent_joined: bool = False
    assigned_agent: Dict[str, Any] | None = None
    visits: int
    chats: int
    came_from: str | None = None
    current_page: CurrentPage | None = None
    device_info: str | None = None
    browser_info: str | None = None
    last_seen_at: str | None = None
    page_views: List[dict] = []
    conversations: List[dict] = []


class ContactTagResponse(BaseModel):
    name: str
    color: str


class ContactResponse(BaseModel):
    contact_key: str
    website_id: int
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    visitor_avatar_color: str | None = None
    tags: List[ContactTagResponse] = []
    last_update: str | None = None


class ContactDetailsResponse(BaseModel):
    contact_key: str
    website_id: int | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    visitor_avatar_color: str | None = None
    tags: List[ContactTagResponse] = []
    last_update: str | None = None
    visits: int
    chats: int
    conversations: List[dict] = []
    form_submissions: List[dict] = []


class InitiateConversationResponse(BaseModel):
    conversation_id: int
    website_id: int
    session_id: str


@router.get("/visitors", response_model=List[VisitorResponse])
def get_visitors(
    website_id: int | None = None,
    recently_left_within_seconds: int = 600,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and not scope.website_ids:
        return []
    if website_id is not None and scope.website_ids is not None:
        if int(website_id) not in set(scope.website_ids):
            return []

    # For OWNER/MANAGER (website_ids=None but org-scoped), restrict to org's websites
    effective_website_ids = scope.website_ids
    if effective_website_ids is None and scope.organization_id is not None:
        from app.models.website import Website
        effective_website_ids = [
            row[0] for row in db.query(Website.id).filter(
                Website.organization_id == scope.organization_id
            ).all()
        ]

    return customers_repo.list_active_visitors(
        db,
        website_id=website_id,
        website_ids=effective_website_ids,
        recently_left_within_seconds=recently_left_within_seconds,
        limit=limit,
    )


@router.get("/visitors/{website_id}/{session_id}", response_model=VisitorDetailsResponse)
def get_visitor_details(
    website_id: int,
    session_id: str,
    recently_left_within_seconds: int = 600,
    page_view_limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and int(website_id) not in set(scope.website_ids):
        raise HTTPException(status_code=403, detail="Visitor not available")
    if scope.organization_id is not None:
        from app.models.website import Website
        w = db.query(Website.organization_id).filter(Website.id == website_id).first()
        if w is None or w[0] != scope.organization_id:
            raise HTTPException(status_code=403, detail="Visitor not available")
    return customers_repo.get_visitor_details(
        db,
        website_id=website_id,
        session_id=session_id,
        team_ids=scope.team_ids,
        recently_left_within_seconds=recently_left_within_seconds,
        page_view_limit=page_view_limit,
    )


@router.post("/visitors/{website_id}/{session_id}/initiate", response_model=InitiateConversationResponse)
def initiate_visitor_conversation(
    website_id: int,
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and int(website_id) not in set(scope.website_ids):
        raise HTTPException(status_code=403, detail="Visitor not available")
    return customers_repo.initiate_conversation_for_visitor(
        db,
        website_id=website_id,
        session_id=session_id,
        agent_id=int(current_user.id),
    )


@router.get("/contacts", response_model=List[ContactResponse])
def get_contacts(
    website_id: int | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and not scope.website_ids:
        return []
    if website_id is not None and scope.website_ids is not None:
        if int(website_id) not in set(scope.website_ids):
            return []
    return customers_repo.list_contacts(
        db,
        website_id=website_id,
        website_ids=None if scope.website_ids is None else scope.website_ids,
        limit=limit,
    )


@router.get("/contacts/{contact_key}", response_model=ContactDetailsResponse)
def get_contact_details(
    contact_key: str,
    website_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    scope = compute_visibility_scope(db, user=current_user)
    if website_id is not None and scope.website_ids is not None:
        if int(website_id) not in set(scope.website_ids):
            raise HTTPException(status_code=403, detail="Contact not available")
    details = customers_repo.get_contact_details(
        db,
        website_id=website_id,
        website_ids=None if scope.website_ids is None else scope.website_ids,
        contact_key=contact_key,
        team_ids=scope.team_ids,
    )
    # Attach form submissions for this contact (by session_id = contact_key)
    from app.repos import forms as forms_repo
    from app.models.website_form import WebsiteForm

    subs = forms_repo.get_submissions_by_session(
        db,
        session_id=contact_key,
        website_id=website_id,
        limit=50,
    )
    form_submissions = []
    _form_cache: dict[int, Any] = {}
    for sub in subs:
        if sub.form_id not in _form_cache:
            _form_cache[sub.form_id] = db.query(WebsiteForm).filter(WebsiteForm.id == sub.form_id).first()
        form = _form_cache[sub.form_id]
        form_submissions.append({
            "id": sub.id,
            "form_id": sub.form_id,
            "form_name": form.name if form else None,
            "form_fields": form.fields if form else [],
            "data": sub.data,
            "conversation_id": sub.conversation_id,
            "created_at": sub.created_at.isoformat() if sub.created_at else None,
        })
    details_dict = details if isinstance(details, dict) else details.model_dump() if hasattr(details, 'model_dump') else dict(details)
    details_dict["form_submissions"] = form_submissions
    return details_dict
