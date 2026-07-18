"""CRUD helpers for WebsiteForm and WebsiteFormSubmission."""

from __future__ import annotations

from typing import Optional
from sqlalchemy.orm import Session

from app.models.website_form import WebsiteForm
from app.models.website_form_submission import WebsiteFormSubmission


# ──────────────────────────────────────────────
# Forms
# ──────────────────────────────────────────────

def get_forms(db: Session, website_id: int) -> list[WebsiteForm]:
    return (
        db.query(WebsiteForm)
        .filter(WebsiteForm.website_id == website_id)
        .order_by(WebsiteForm.id)
        .all()
    )


def get_form_by_id(db: Session, form_id: int) -> Optional[WebsiteForm]:
    return db.query(WebsiteForm).filter(WebsiteForm.id == form_id).first()


def get_form_by_slug(db: Session, website_id: int, slug: str) -> Optional[WebsiteForm]:
    return (
        db.query(WebsiteForm)
        .filter(WebsiteForm.website_id == website_id, WebsiteForm.slug == slug)
        .first()
    )


def create_form(
    db: Session,
    website_id: int,
    name: str,
    slug: str,
    fields: list,
    submit_label: str = "Send",
    enabled: bool = True,
    is_contact_card: bool = False,
) -> WebsiteForm:
    form = WebsiteForm(
        website_id=website_id,
        name=name,
        slug=slug,
        fields=fields,
        submit_label=submit_label,
        enabled=enabled,
        is_contact_card=is_contact_card,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


def update_form(db: Session, form: WebsiteForm, **kwargs) -> WebsiteForm:
    for key, value in kwargs.items():
        if hasattr(form, key):
            setattr(form, key, value)
    db.commit()
    db.refresh(form)
    return form


def delete_form(db: Session, form: WebsiteForm) -> None:
    db.delete(form)
    db.commit()


# ──────────────────────────────────────────────
# Submissions
# ──────────────────────────────────────────────

def create_submission(
    db: Session,
    form_id: int,
    data: dict,
    conversation_id: int | None = None,
    session_id: str | None = None,
    message_id: int | None = None,
) -> WebsiteFormSubmission:
    sub = WebsiteFormSubmission(
        form_id=form_id,
        conversation_id=conversation_id,
        session_id=session_id,
        message_id=message_id,
        data=data,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def get_submission_by_message_id(db: Session, message_id: int) -> Optional[WebsiteFormSubmission]:
    return db.query(WebsiteFormSubmission).filter(WebsiteFormSubmission.message_id == message_id).first()


def get_submissions(db: Session, form_id: int, limit: int = 100, offset: int = 0) -> list[WebsiteFormSubmission]:
    return (
        db.query(WebsiteFormSubmission)
        .filter(WebsiteFormSubmission.form_id == form_id)
        .order_by(WebsiteFormSubmission.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_submissions_by_conversation(db: Session, conversation_id: int) -> list[WebsiteFormSubmission]:
    """Return all form submissions linked to a conversation, oldest first."""
    return (
        db.query(WebsiteFormSubmission)
        .filter(WebsiteFormSubmission.conversation_id == conversation_id)
        .order_by(WebsiteFormSubmission.id.asc())
        .all()
    )


def get_submissions_by_session(
    db: Session,
    session_id: str,
    website_id: int | None = None,
    limit: int = 50,
) -> list[WebsiteFormSubmission]:
    """Return all form submissions for a session (optionally scoped to a website)."""
    q = db.query(WebsiteFormSubmission).filter(
        WebsiteFormSubmission.session_id == session_id
    )
    if website_id is not None:
        # Filter via join with WebsiteForm to scope to website
        q = q.join(WebsiteForm, WebsiteForm.id == WebsiteFormSubmission.form_id).filter(
            WebsiteForm.website_id == website_id
        )
    return q.order_by(WebsiteFormSubmission.id.desc()).limit(limit).all()


def ensure_default_form_for_website(db: Session, website_id: int) -> None:
    """Create the default 'Leave us a message' offline contact form if it doesn't exist."""
    existing = get_form_by_slug(db, website_id, "offline-contact")
    if existing:
        return
    form = WebsiteForm(
        website_id=website_id,
        name="Leave us a message",
        slug="offline-contact",
        fields=[
            {"label": "Your Name", "field_name": "name", "type": "text", "required": True, "placeholder": "Enter your name"},
            {"label": "Phone Number", "field_name": "phone", "type": "tel", "required": True, "placeholder": "Enter your phone number"},
            {"label": "Email Address", "field_name": "email", "type": "email", "required": False, "placeholder": "Enter your email (optional)"},
            {"label": "Message", "field_name": "message", "type": "textarea", "required": True, "placeholder": "What can we help you with?"},
        ],
        submit_label="Send Message",
        enabled=True,
    )
    db.add(form)
    try:
        db.commit()
    except Exception:
        db.rollback()
