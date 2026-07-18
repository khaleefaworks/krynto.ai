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
from app.services.lead_integration_service import enqueue_lead, force_resend_delivery
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


def _delivery_to_dict(delivery: LeadIntegrationDelivery) -> dict:
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
    if statuses == {LeadDeliveryStatus.SENT}:
        return "sent"
    if LeadDeliveryStatus.SENT in statuses and (LeadDeliveryStatus.FAILED in statuses or LeadDeliveryStatus.PENDING in statuses):
        return "partial"
    if LeadDeliveryStatus.FAILED in statuses:
        return "failed"
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

    return {
        "has_integrations": integrations_repo.has_enabled_integrations(db, conversation.website_id),
        "status": _aggregate_status(deliveries),
        "deliveries": [_delivery_to_dict(d) for d in deliveries],
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
