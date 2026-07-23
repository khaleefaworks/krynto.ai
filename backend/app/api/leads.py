"""Agent-facing lead-integration endpoints for a single conversation: current
delivery status, the form-submission + retry history behind it, a manual
"send now" action (for contact details an agent typed in from a chat message
rather than a filled contact card), and a force-resend for one delivery.

The Contacts page (grouping multiple conversations under one contact) targets
whichever conversation the agent has open/most recent — there's no separate
contact-level identity here, deliveries are always conversation-scoped.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_agent
from app.models.conversation import Conversation
from app.models.lead_integration_delivery import LeadIntegrationDelivery, LeadDeliveryStatus
from app.models.user import User
from app.repos import forms as forms_repo
from app.repos import website_integrations as integrations_repo
from app.repos import lead_integration_deliveries as deliveries_repo
from app.services.lead_integration_service import (
    collect_lead_form_submissions,
    enqueue_lead,
    force_resend_delivery,
    send_confirmed_draft,
)
from app.services.visibility import compute_visibility_scope

router = APIRouter(prefix="/conversations/{conversation_id}/leads", tags=["leads"])


def _ensure_visible(db: Session, *, current_user: User, conversation_id: int) -> Conversation:
    conversation = db.query(Conversation).filter_by(id=int(conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    scope = compute_visibility_scope(db, user=current_user)
    if scope.website_ids is not None and int(conversation.website_id) not in set(scope.website_ids):
        raise HTTPException(status_code=403, detail="Chat not available")
    if scope.team_ids is not None:
        tid = getattr(conversation, "team_id", None)
        if tid is None or int(tid) not in set(scope.team_ids):
            raise HTTPException(status_code=403, detail="Chat not available")
    return conversation


def _delivery_to_dict(delivery: LeadIntegrationDelivery, *, form_submissions_preview: dict | None = None) -> dict:
    payload = delivery.payload or {}
    # While still awaiting confirmation, show the live set of submitted
    # forms (passed in by the caller) since the payload itself isn't
    # enriched until send time. Once sent/failed, fall back to whatever was
    # actually frozen into the payload for that attempt.
    if form_submissions_preview is None:
        form_submissions_preview = (payload.get("extra_fields") or {}).get("form_submissions") or {}
    return {
        "id": delivery.id,
        "integration_id": delivery.integration_id,
        "integration_name": delivery.integration.name if delivery.integration else None,
        "source": delivery.source,
        "status": delivery.status.value if hasattr(delivery.status, "value") else delivery.status,
        "attempt_count": delivery.attempt_count,
        "last_attempt_at": delivery.last_attempt_at.isoformat() if delivery.last_attempt_at else None,
        "next_retry_at": delivery.next_retry_at.isoformat() if delivery.next_retry_at else None,
        "error_message": delivery.error_message,
        "created_at": delivery.created_at.isoformat() if delivery.created_at else None,
        # Only meaningful while status == awaiting_confirmation — what the
        # agent's review card shows/edits before confirming.
        "draft_name": payload.get("name"),
        "draft_email": payload.get("email"),
        "draft_phone": payload.get("phone"),
        # Every other form (Virtual Office, etc.) submitted in this
        # conversation, keyed by form name — merged into the webhook JSON
        # alongside draft_name/email/phone once confirmed.
        "draft_form_submissions": form_submissions_preview,
    }


def _submission_to_dict(submission) -> dict:
    return {
        "id": submission.id,
        "form_id": submission.form_id,
        "form_name": submission.form.name if submission.form else None,
        "data": submission.data,
        "created_at": submission.created_at.isoformat() if submission.created_at else None,
    }


def _aggregate_status(deliveries: list[LeadIntegrationDelivery]) -> str:
    if not deliveries:
        return "not_sent"
    statuses = {d.status for d in deliveries}
    # Awaiting review takes priority in the summary badge — it's the state
    # that needs an agent's attention right now.
    if LeadDeliveryStatus.AWAITING_CONFIRMATION in statuses:
        return "awaiting_confirmation"
    if statuses <= {LeadDeliveryStatus.SENT, LeadDeliveryStatus.CANCELLED} and LeadDeliveryStatus.SENT in statuses:
        return "sent"
    if LeadDeliveryStatus.SENT in statuses and (LeadDeliveryStatus.FAILED in statuses or LeadDeliveryStatus.PENDING in statuses):
        return "partial"
    if LeadDeliveryStatus.FAILED in statuses:
        return "failed"
    if statuses == {LeadDeliveryStatus.CANCELLED}:
        return "not_sent"
    return "pending"


@router.get("")
def get_lead_status(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    conversation = _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    deliveries = (
        db.query(LeadIntegrationDelivery)
        .filter(LeadIntegrationDelivery.conversation_id == conversation_id)
        .order_by(LeadIntegrationDelivery.created_at.desc())
        .all()
    )
    submissions = forms_repo.get_submissions_by_conversation(db, conversation_id)

    # Computed once and reused for every awaiting-confirmation row instead
    # of per-delivery, since it's the same live set of forms regardless of
    # which integration the draft targets.
    live_form_submissions = None
    if any(d.status == LeadDeliveryStatus.AWAITING_CONFIRMATION for d in deliveries):
        live_form_submissions = collect_lead_form_submissions(db, conversation_id)

    return {
        "has_integrations": integrations_repo.has_enabled_integrations(db, conversation.website_id),
        "status": _aggregate_status(deliveries),
        "deliveries": [
            _delivery_to_dict(
                d,
                form_submissions_preview=live_form_submissions
                if d.status == LeadDeliveryStatus.AWAITING_CONFIRMATION
                else None,
            )
            for d in deliveries
        ],
        "submissions": [_submission_to_dict(s) for s in reversed(submissions)],
    }


class SendLeadRequest(BaseModel):
    form_id: int | None = None


@router.post("")
async def send_lead_now(
    conversation_id: int,
    body: SendLeadRequest = SendLeadRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    """Manually push the conversation's current visitor_name/email/phone out
    to integrations — for contact details a visitor typed in chat that an
    agent transcribed into the visitor-details panel rather than a filled
    contact-card form."""
    conversation = _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    if not (conversation.visitor_name or conversation.visitor_email or conversation.visitor_phone):
        raise HTTPException(status_code=422, detail="No visitor contact details to send yet")

    if not integrations_repo.has_enabled_integrations(db, conversation.website_id):
        raise HTTPException(status_code=422, detail="No integrations configured for this website")

    enqueue_lead(
        db,
        website_id=conversation.website_id,
        conversation_id=conversation.id,
        form_id=body.form_id,
        source="agent_manual",
        name=conversation.visitor_name,
        email=conversation.visitor_email,
        phone=conversation.visitor_phone,
        hold_for_confirmation=False,
    )
    return {"success": True}


@router.post("/deliveries/{delivery_id}/resend")
async def resend_delivery(
    conversation_id: int,
    delivery_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    delivery = (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.id == delivery_id,
            LeadIntegrationDelivery.conversation_id == conversation_id,
        )
        .first()
    )
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    try:
        return await force_resend_delivery(db, delivery_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Delivery not found")


_MAX_CUSTOM_FIELDS = 20
_MAX_CUSTOM_FIELD_KEY_LEN = 100
_MAX_CUSTOM_FIELD_VALUE_LEN = 1000


class ConfirmLeadRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    # One-off key/value pairs the agent learned for THIS lead specifically
    # (e.g. a budget mentioned verbally) — merged into just this delivery,
    # never saved to the integration's own config.
    custom_fields: dict[str, str] | None = None


@router.post("/deliveries/{delivery_id}/confirm")
async def confirm_delivery(
    conversation_id: int,
    delivery_id: int,
    body: ConfirmLeadRequest = ConfirmLeadRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    """Send a lead that's been held for review — optionally applying an
    inline correction first (e.g. the agent fixing a mistyped phone number
    before it goes out)."""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    delivery = (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.id == delivery_id,
            LeadIntegrationDelivery.conversation_id == conversation_id,
        )
        .first()
    )
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery.status != LeadDeliveryStatus.AWAITING_CONFIRMATION:
        raise HTTPException(status_code=409, detail="This lead is not awaiting confirmation")

    custom_fields = body.custom_fields or {}
    if len(custom_fields) > _MAX_CUSTOM_FIELDS:
        raise HTTPException(status_code=422, detail=f"custom_fields is limited to {_MAX_CUSTOM_FIELDS} pairs")
    for key, value in custom_fields.items():
        if len(key) > _MAX_CUSTOM_FIELD_KEY_LEN or len(str(value)) > _MAX_CUSTOM_FIELD_VALUE_LEN:
            raise HTTPException(status_code=422, detail=f"custom_fields entry '{key}' is too long")

    try:
        return await send_confirmed_draft(
            db,
            delivery_id,
            name=body.name,
            email=body.email,
            phone=body.phone,
            custom_fields=body.custom_fields,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Delivery not found")


@router.post("/deliveries/{delivery_id}/discard")
async def discard_delivery(
    conversation_id: int,
    delivery_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    """Drop a held lead without ever sending it (e.g. a garbled first
    capture the visitor immediately corrected through a different form)."""
    _ensure_visible(db, current_user=current_user, conversation_id=conversation_id)

    delivery = (
        db.query(LeadIntegrationDelivery)
        .filter(
            LeadIntegrationDelivery.id == delivery_id,
            LeadIntegrationDelivery.conversation_id == conversation_id,
        )
        .first()
    )
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery.status != LeadDeliveryStatus.AWAITING_CONFIRMATION:
        raise HTTPException(status_code=409, detail="This lead is not awaiting confirmation")

    deliveries_repo.discard_draft(db, delivery)
    from app.services.lead_integration_service import _broadcast_lead_delivery_update

    await _broadcast_lead_delivery_update(db, website_id=delivery.website_id, conversation_id=conversation_id)
    return _delivery_to_dict(delivery)
