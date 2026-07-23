"""REST API for website forms (admin only)."""

from __future__ import annotations

from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi import Response as FastAPIResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_admin, require_authenticated_user
from app.core.widget_origin import enforce_widget_domain_or_403
from app.models.user import User
from app.repos import forms as forms_repo
from app.repos import conversations as conversations_repo
from app.models.website import Website
from app.models.website_form import WebsiteForm
from app.services.visibility import compute_visibility_scope, ensure_website_visible

router = APIRouter(prefix="/websites/{website_id}/forms", tags=["forms"])


def _set_widget_cors_headers(*, response: FastAPIResponse, request: Request) -> None:
    """Mirrors widget.py's helper — public visitor-facing endpoints reflect the
    caller's Origin instead of using the dashboard's restrictive global CORS
    config, since the widget is embedded on arbitrary customer domains."""
    origin = request.headers.get("origin") or request.headers.get("Origin")
    if not origin:
        return
    request_headers = request.headers.get("access-control-request-headers") or request.headers.get(
        "Access-Control-Request-Headers"
    )
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Max-Age"] = "600"
    response.headers["Access-Control-Allow-Headers"] = request_headers or "*"


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────

class FormFieldSchema(BaseModel):
    name: str
    label: str
    field_type: str = "text"   # text | email | phone | textarea | select
    required: bool = False
    options: list[str] = Field(default_factory=list)  # for select fields
    placeholder: Optional[str] = None


class FormCreate(BaseModel):
    name: str
    slug: str
    fields: list[FormFieldSchema] = Field(default_factory=list)
    submit_label: str = "Send"
    enabled: bool = True
    is_contact_card: bool = False
    include_in_lead: bool = True


class FormUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    fields: Optional[list[FormFieldSchema]] = None
    submit_label: Optional[str] = None
    enabled: Optional[bool] = None
    is_contact_card: Optional[bool] = None
    include_in_lead: Optional[bool] = None


class SubmissionCreate(BaseModel):
    data: dict[str, Any]
    conversation_id: Optional[int] = None
    session_id: Optional[str] = None
    # CC1: set when this submission fills a specific agent-sent contact-card
    # message, so it can be tied to that exact card (and its fillability
    # enforced) rather than just the form/conversation in general.
    message_id: Optional[int] = None


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _require_website(website_id: int, db: Session) -> Website:
    """Raise 404 if website not found."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


def _enforce_website_access(db: Session, *, website_id: int, user: User) -> None:
    scope = compute_visibility_scope(db, user=user)
    try:
        ensure_website_visible(scope, website_id=int(website_id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Website not assigned")


def _validate_submission_data(data: dict[str, Any], *, form_fields: list[Any] | None) -> dict[str, Any]:
    """Thin HTTPException-raising wrapper around forms_repo.validate_submission_data
    — see that function for the actual rules; kept here so this router's
    existing call sites don't need to change."""
    try:
        return forms_repo.validate_submission_data(data, form_fields=form_fields)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _form_to_dict(form):
    return {
        "id": form.id,
        "website_id": form.website_id,
        "name": form.name,
        "slug": form.slug,
        "fields": form.fields,
        "submit_label": form.submit_label,
        "enabled": form.enabled,
        "is_contact_card": form.is_contact_card,
        "include_in_lead": form.include_in_lead,
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
    }


def _unset_other_contact_cards(db: Session, *, website_id: int, keep_form_id: int | None) -> None:
    """Only one form per website may be the contact card — clear the flag on any other."""
    query = db.query(WebsiteForm).filter(
        WebsiteForm.website_id == website_id, WebsiteForm.is_contact_card.is_(True)
    )
    if keep_form_id is not None:
        query = query.filter(WebsiteForm.id != keep_form_id)
    others = query.all()
    for other in others:
        other.is_contact_card = False
    if others:
        db.commit()


def _submission_to_dict(sub, form_name: str | None = None):
    return {
        "id": sub.id,
        "form_id": sub.form_id,
        "form_name": form_name,
        "conversation_id": sub.conversation_id,
        "session_id": sub.session_id,
        "data": sub.data,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


# ──────────────────────────────────────────────
# Public endpoint: widget looks up the contact-card form (no auth)
# ──────────────────────────────────────────────

@router.options("/contact-card")
async def get_contact_card_form_options(website_id: int, request: Request, response: FastAPIResponse):
    _set_widget_cors_headers(response=response, request=request)
    return FastAPIResponse(status_code=204)


def _get_contact_card_form(db: Session, website_id: int) -> WebsiteForm | None:
    return (
        db.query(WebsiteForm)
        .filter(
            WebsiteForm.website_id == website_id,
            WebsiteForm.is_contact_card.is_(True),
            WebsiteForm.enabled.is_(True),
        )
        .first()
    )


@router.get("/contact-card")
def get_contact_card_form(
    website_id: int,
    request: Request,
    response: FastAPIResponse,
    db: Session = Depends(get_db),
):
    """Public — lets the widget discover whether this website has a
    contact-card form configured, for the offline gate's extra-fields
    extension. Returns null if none/disabled.

    Gated by the widget domain lock, so this is *not* reachable from the
    agent dashboard (different origin) — see /for-agent below, which lists
    every enabled form for the agent's "#" send-a-form menu."""
    website = _require_website(website_id, db)
    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    _set_widget_cors_headers(response=response, request=request)

    form = _get_contact_card_form(db, website_id)
    if not form:
        return None
    return {
        "id": form.id,
        "name": form.name,
        "fields": form.fields,
        "submit_label": form.submit_label,
    }


@router.get("/for-agent")
def list_forms_for_agent(
    website_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """CC1: every enabled form for this website, for the agent dashboard's
    "#" contact-card menu — a website can have any number of forms, so the
    agent picks which one to send rather than there being a single fixed
    "the" contact card. Gated by auth + visibility scope instead of the
    widget domain lock (the dashboard isn't on the customer's domain, so
    that check would always fail here)."""
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)

    forms = (
        db.query(WebsiteForm)
        .filter(WebsiteForm.website_id == website_id, WebsiteForm.enabled.is_(True))
        .order_by(WebsiteForm.id)
        .all()
    )
    return [{"id": f.id, "name": f.name} for f in forms]


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────

@router.get("")
def list_forms(
    website_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    forms = forms_repo.get_forms(db, website_id)
    return [_form_to_dict(f) for f in forms]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_form(
    website_id: int,
    body: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    # Enforce unique slug per website
    if forms_repo.get_form_by_slug(db, website_id, body.slug):
        raise HTTPException(status_code=409, detail="A form with this slug already exists for this website")
    if body.is_contact_card:
        _unset_other_contact_cards(db, website_id=website_id, keep_form_id=None)
    form = forms_repo.create_form(
        db,
        website_id=website_id,
        name=body.name,
        slug=body.slug,
        fields=[f.model_dump() for f in body.fields],
        submit_label=body.submit_label,
        enabled=body.enabled,
        is_contact_card=body.is_contact_card,
        include_in_lead=body.include_in_lead,
    )
    return _form_to_dict(form)


@router.get("/{form_id}")
def get_form(
    website_id: int,
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    return _form_to_dict(form)


@router.put("/{form_id}")
def update_form(
    website_id: int,
    form_id: int,
    body: FormUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.slug is not None and body.slug != form.slug:
        if forms_repo.get_form_by_slug(db, website_id, body.slug):
            raise HTTPException(status_code=409, detail="A form with this slug already exists for this website")
        updates["slug"] = body.slug
    if body.fields is not None:
        updates["fields"] = [f.model_dump() for f in body.fields]
    if body.submit_label is not None:
        updates["submit_label"] = body.submit_label
    if body.enabled is not None:
        updates["enabled"] = body.enabled
    if body.is_contact_card is not None:
        updates["is_contact_card"] = body.is_contact_card
        if body.is_contact_card:
            _unset_other_contact_cards(db, website_id=website_id, keep_form_id=form_id)
    if body.include_in_lead is not None:
        updates["include_in_lead"] = body.include_in_lead
    form = forms_repo.update_form(db, form, **updates)
    return _form_to_dict(form)


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_form(
    website_id: int,
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    forms_repo.delete_form(db, form)


# ──────────────────────────────────────────────
# Public endpoint: accept submission from widget (no auth)
# ──────────────────────────────────────────────

@router.options("/{form_id}/submissions")
async def submit_form_options(website_id: int, form_id: int, request: Request, response: FastAPIResponse):
    """CORS preflight for the public submission endpoint (JSON POST from an
    arbitrary customer domain triggers one)."""
    _set_widget_cors_headers(response=response, request=request)
    return FastAPIResponse(status_code=204)


@router.post("/{form_id}/submissions", status_code=status.HTTP_201_CREATED)
async def submit_form(
    website_id: int,
    form_id: int,
    body: SubmissionCreate,
    request: Request,
    response: FastAPIResponse,
    db: Session = Depends(get_db),
):
    """Public endpoint — no authentication required (widget submits here)."""
    website = _require_website(website_id, db)
    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    _set_widget_cors_headers(response=response, request=request)

    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id or not form.enabled:
        raise HTTPException(status_code=404, detail="Form not found")

    conversation = None
    conversation_id = body.conversation_id
    if conversation_id is not None:
        conversation = conversations_repo.get_conversation_by_id(db, conversation_id)
        if not conversation or int(conversation.website_id) != int(website_id):
            raise HTTPException(status_code=422, detail="Invalid conversation_id for this website")
        if body.session_id and str(conversation.session_id) != str(body.session_id):
            raise HTTPException(status_code=422, detail="session_id does not match conversation_id")

    # CC1: a submission tied to a specific sent card must still be fillable —
    # same check that decides what the card displays, so accept/reject can
    # never drift from what the visitor sees.
    card_message = None
    if body.message_id is not None:
        from app.models.message import Message
        from app.core.message_presenter import contact_card_state

        card_message = db.query(Message).filter(Message.id == body.message_id).first()
        if (
            not card_message
            or card_message.event_type != "contact_card"
            or (conversation_id is not None and card_message.conversation_id != conversation_id)
        ):
            raise HTTPException(status_code=422, detail="Invalid message_id for this form")
        state = contact_card_state(db, card_message)
        if state["status"] != "pending":
            raise HTTPException(status_code=409, detail="This form is no longer available. Ask the agent to resend it.")

    validated_data = _validate_submission_data(body.data, form_fields=form.fields)
    sub = forms_repo.create_submission(
        db,
        form_id=form_id,
        data=validated_data,
        conversation_id=conversation_id,
        session_id=body.session_id,
        message_id=body.message_id,
    )

    if form.is_contact_card:
        _capture_lead_from_submission(
            db,
            website_id=website_id,
            conversation=conversation if conversation_id is not None else None,
            form_fields=form.fields,
            data=validated_data,
            form_id=form.id,
        )

    if card_message is not None and conversation is not None:
        from app.services.agent_service import AgentService

        await AgentService(db).broadcast_to_active_agents(
            website_id=int(website_id),
            message_data={
                "type": "contact_card_submitted",
                "conversation_id": conversation.id,
                "message_id": card_message.id,
                "form_id": form_id,
                "data": validated_data,
                "visitor_name": conversation.visitor_name,
                "visitor_email": conversation.visitor_email,
                "visitor_phone": conversation.visitor_phone,
            },
            include_global=True,
            conversation_team_id=getattr(conversation, "team_id", None),
        )

    return _submission_to_dict(sub, form_name=form.name)


def _capture_lead_from_submission(
    db: Session, *, website_id: int, conversation, form_fields: list, data: dict, form_id: int | None = None
) -> None:
    """Pull name/email/phone out of a contact-card submission by field_type
    (email/phone are unambiguous; "name" is matched by the field's machine
    name since there's no dedicated field_type for it), fill the
    conversation's visitor_* columns if still empty (same rule the offline
    gate uses), and enqueue the lead — everything else in the submission
    rides along as extra_fields.
    """
    name, email, phone, extra_fields = forms_repo.extract_contact_fields(form_fields, data)

    if conversation is not None:
        try:
            from app.repos.conversations import update_visitor_contact_fields

            changed = update_visitor_contact_fields(conversation, name=name, email=email, phone=phone)
            if changed:
                db.commit()
        except Exception:
            db.rollback()

    try:
        from app.services.lead_integration_service import enqueue_lead

        enqueue_lead(
            db,
            website_id=website_id,
            conversation_id=conversation.id if conversation is not None else None,
            form_id=form_id,
            source="live_chat_form",
            name=name or (conversation.visitor_name if conversation is not None else None),
            email=email or (conversation.visitor_email if conversation is not None else None),
            phone=phone or (conversation.visitor_phone if conversation is not None else None),
            extra_fields=extra_fields,
        )
    except Exception:
        pass


@router.get("/{form_id}/submissions")
def list_submissions(
    website_id: int,
    form_id: int,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    subs = forms_repo.get_submissions(db, form_id, limit=limit, offset=offset)
    return [_submission_to_dict(s, form_name=form.name) for s in subs]
