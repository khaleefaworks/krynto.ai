"""CRUD helpers for WebsiteForm and WebsiteFormSubmission."""

from __future__ import annotations

import re
from typing import Any, Optional
import phonenumbers
from sqlalchemy.orm import Session

from app.models.website_form import WebsiteForm
from app.models.website_form_submission import WebsiteFormSubmission

MAX_SUBMISSION_FIELDS = 50
MAX_SUBMISSION_FIELD_NAME_CHARS = 100
MAX_SUBMISSION_FIELD_VALUE_CHARS = 2000
MAX_SUBMISSION_TOTAL_CHARS = 20000
MAX_SUBMISSION_FIELD_NAME_PREVIEW_CHARS = 32

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Widget's country-code picker sends E.164 (+<code><number>); older/legacy
# clients still send bare national digits, which we assume are Indian since
# that's the widget's default country.
DEFAULT_PHONE_REGION = "IN"


def is_valid_phone(value: str) -> bool:
    region = None if value.strip().startswith("+") else DEFAULT_PHONE_REGION
    try:
        parsed = phonenumbers.parse(value, region)
    except phonenumbers.NumberParseException:
        return False
    return phonenumbers.is_valid_number(parsed)


def validate_contact_field(field_type: str, value: str) -> Optional[str]:
    """Returns an error message if `value` fails field_type's format rules
    (email/phone), else None for a blank value or any other field type.
    Shared by every place a name/email/phone can be written: the visitor-
    facing submission endpoint (api/forms.py), an agent's after-the-fact
    edit to that same submission (chats.py's form-submission PATCH), and the
    no-submission-yet contact fallback (conversation_metadata.py's PATCH) —
    so all three enforce the same rules instead of only the first ever
    having checked.
    """
    if not value.strip():
        return None
    if field_type == "email" and not EMAIL_RE.match(value.strip()):
        return "Invalid email address"
    if field_type == "phone" and not is_valid_phone(value):
        return "Invalid phone number"
    return None


def _normalize_form_field_defs(form_fields: list[Any] | None) -> dict[str, dict[str, Any]]:
    allowed: dict[str, dict[str, Any]] = {}
    for field in form_fields or []:
        if not isinstance(field, dict):
            continue
        key = str(field.get("name") or field.get("field_name") or "").strip()
        if not key:
            continue
        allowed[key] = {
            "required": bool(field.get("required")),
            "field_type": str(field.get("field_type") or field.get("type") or "text"),
        }
    return allowed


def validate_submission_data(
    data: dict[str, Any], *, form_fields: list[Any] | None, require_all_fields: bool = True
) -> dict[str, Any]:
    """Validates a submission's data against its form's field defs (unknown
    fields, per-field length caps, email/phone format, required fields) and
    returns the normalized dict, or raises ValueError with a user-facing
    message. HTTP-agnostic (a ValueError, not HTTPException) so it can be
    used from any API module — see validate_contact_field's docstring for
    why this needs to be shared rather than living only in api/forms.py.

    require_all_fields=False (an agent editing one field of an existing
    submission — chats.py's form-submission PATCH merges `data` onto the
    submission's existing values first, so `data` here is already the full
    merged record) skips nothing extra here; it exists so a caller that
    genuinely only wants to touch a subset can opt out of the
    missing-required-fields check while still getting the per-field format
    checks. Left on by default since the initial visitor submission (and an
    agent's full-record edit) should always satisfy every required field.
    """
    if len(data) > MAX_SUBMISSION_FIELDS:
        raise ValueError("Too many submitted fields")

    allowed_fields = _normalize_form_field_defs(form_fields)
    unknown_keys = [k for k in data.keys() if k not in allowed_fields]
    if unknown_keys:
        raise ValueError(f"Unknown fields: {', '.join(unknown_keys)}")

    normalized: dict[str, Any] = {}
    total_chars = 0
    for key, value in data.items():
        if len(key) > MAX_SUBMISSION_FIELD_NAME_CHARS:
            raise ValueError(f"Field name too long: {key[:MAX_SUBMISSION_FIELD_NAME_PREVIEW_CHARS]}")
        if isinstance(value, (dict, list, tuple, set)):
            raise ValueError(f"Invalid value type for field: {key}")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValueError(f"Invalid value type for field: {key}")
        value_text = "" if value is None else str(value)
        if len(value_text) > MAX_SUBMISSION_FIELD_VALUE_CHARS:
            raise ValueError(f"Field value too long: {key}")

        field_type = allowed_fields[key].get("field_type", "text")
        err = validate_contact_field(field_type, value_text)
        if err:
            raise ValueError(f"{err}: {key}")

        total_chars += len(key) + len(value_text)
        normalized[key] = value

    if total_chars > MAX_SUBMISSION_TOTAL_CHARS:
        raise ValueError("Submission payload too large")

    if require_all_fields:
        missing_required: list[str] = []
        for key, field in allowed_fields.items():
            if not field.get("required"):
                continue
            value = normalized.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                missing_required.append(key)
        if missing_required:
            raise ValueError(f"Missing required fields: {', '.join(missing_required)}")

    return normalized


def extract_contact_fields(form_fields: list, data: dict) -> tuple[str | None, str | None, str | None, dict]:
    """Pull name/email/phone out of a contact-card submission's data, by
    field_type (email/phone are unambiguous; "name" is matched by the
    field's machine name since there's no dedicated field_type for it).
    Shared by the initial capture (forms.py's _capture_lead_from_submission)
    and by an agent later editing that same submission (chats.py's
    form-submission PATCH) so both paths agree on what counts as the
    visitor's name/email/phone. Returns (name, email, phone, everything_else).
    """
    name = email = phone = None
    extra_fields: dict = {}
    field_types = {str(f.get("name") or ""): str(f.get("field_type") or "text") for f in (form_fields or []) if isinstance(f, dict)}

    for key, value in data.items():
        ftype = field_types.get(key, "text")
        if ftype == "email" and email is None:
            email = value
        elif ftype == "phone" and phone is None:
            phone = value
        elif key == "name" and name is None:
            name = value
        else:
            extra_fields[key] = value
    return name, email, phone, extra_fields


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
    include_in_lead: bool = True,
) -> WebsiteForm:
    form = WebsiteForm(
        website_id=website_id,
        name=name,
        slug=slug,
        fields=fields,
        submit_label=submit_label,
        enabled=enabled,
        is_contact_card=is_contact_card,
        include_in_lead=include_in_lead,
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


def get_submission_by_id(db: Session, submission_id: int) -> Optional[WebsiteFormSubmission]:
    return db.query(WebsiteFormSubmission).filter(WebsiteFormSubmission.id == submission_id).first()


def update_submission_data(db: Session, submission: WebsiteFormSubmission, data: dict) -> WebsiteFormSubmission:
    submission.data = data
    db.commit()
    db.refresh(submission)
    return submission


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
