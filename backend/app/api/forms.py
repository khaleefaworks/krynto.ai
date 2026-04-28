"""REST API for website forms (admin only)."""

from __future__ import annotations

from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_admin
from app.models.user import User
from app.repos import forms as forms_repo
from app.models.website import Website

router = APIRouter(prefix="/websites/{website_id}/forms", tags=["forms"])


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


class FormUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    fields: Optional[list[FormFieldSchema]] = None
    submit_label: Optional[str] = None
    enabled: Optional[bool] = None


class SubmissionCreate(BaseModel):
    data: dict[str, Any]
    conversation_id: Optional[int] = None
    session_id: Optional[str] = None


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _require_website(website_id: int, db: Session) -> Website:
    """Raise 404 if website not found."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


def _form_to_dict(form):
    return {
        "id": form.id,
        "website_id": form.website_id,
        "name": form.name,
        "slug": form.slug,
        "fields": form.fields,
        "submit_label": form.submit_label,
        "enabled": form.enabled,
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
    }


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
# Endpoints
# ──────────────────────────────────────────────

@router.get("")
def list_forms(
    website_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
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
    # Enforce unique slug per website
    if forms_repo.get_form_by_slug(db, website_id, body.slug):
        raise HTTPException(status_code=409, detail="A form with this slug already exists for this website")
    form = forms_repo.create_form(
        db,
        website_id=website_id,
        name=body.name,
        slug=body.slug,
        fields=[f.model_dump() for f in body.fields],
        submit_label=body.submit_label,
        enabled=body.enabled,
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
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    forms_repo.delete_form(db, form)


# ──────────────────────────────────────────────
# Public endpoint: accept submission from widget (no auth)
# ──────────────────────────────────────────────

@router.post("/{form_id}/submissions", status_code=status.HTTP_201_CREATED)
def submit_form(
    website_id: int,
    form_id: int,
    body: SubmissionCreate,
    db: Session = Depends(get_db),
):
    """Public endpoint — no authentication required (widget submits here)."""
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id or not form.enabled:
        raise HTTPException(status_code=404, detail="Form not found")
    sub = forms_repo.create_submission(
        db,
        form_id=form_id,
        data=body.data,
        conversation_id=body.conversation_id,
        session_id=body.session_id,
    )
    return _submission_to_dict(sub, form_name=form.name)


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
    form = forms_repo.get_form_by_id(db, form_id)
    if not form or form.website_id != website_id:
        raise HTTPException(status_code=404, detail="Form not found")
    subs = forms_repo.get_submissions(db, form_id, limit=limit, offset=offset)
    return [_submission_to_dict(s, form_name=form.name) for s in subs]
