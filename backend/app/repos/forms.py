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
) -> WebsiteForm:
    form = WebsiteForm(
        website_id=website_id,
        name=name,
        slug=slug,
        fields=fields,
        submit_label=submit_label,
        enabled=enabled,
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
) -> WebsiteFormSubmission:
    sub = WebsiteFormSubmission(
        form_id=form_id,
        conversation_id=conversation_id,
        session_id=session_id,
        data=data,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def get_submissions(db: Session, form_id: int, limit: int = 100, offset: int = 0) -> list[WebsiteFormSubmission]:
    return (
        db.query(WebsiteFormSubmission)
        .filter(WebsiteFormSubmission.form_id == form_id)
        .order_by(WebsiteFormSubmission.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
