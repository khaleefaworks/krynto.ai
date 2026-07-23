"""REST API for per-website outbound integrations (admin only).

Scope today: generic outbound webhooks for captured leads — a website can
register any number of them (Frappe's own webhook doctype, Zapier, n8n, a
custom endpoint, whatever). `type` is a discriminator so a future integration
kind is a new enum value, not a new router.
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_admin
from app.models.user import User
from app.models.website import Website
from app.models.website_integration import WebsiteIntegration, WebsiteIntegrationType
from app.repos import website_integrations as integrations_repo
from app.repos import forms as forms_repo
from app.services.visibility import compute_visibility_scope, ensure_website_visible

router = APIRouter(prefix="/websites/{website_id}/integrations", tags=["integrations"])


def _require_website(website_id: int, db: Session) -> Website:
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


def _require_webhook(db: Session, *, website_id: int, integration_id: int) -> WebsiteIntegration:
    integration = (
        db.query(WebsiteIntegration)
        .filter(WebsiteIntegration.id == integration_id, WebsiteIntegration.website_id == website_id)
        .first()
    )
    if not integration:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return integration


_MAX_CUSTOM_FIELDS = 20
_MAX_CUSTOM_FIELD_KEY_LEN = 100
_MAX_CUSTOM_FIELD_VALUE_LEN = 1000


def _validate_metadata_fields(field_ids: list[str]) -> None:
    from app.services.lead_metadata_fields import is_valid_field_id

    unknown = [f for f in field_ids if not is_valid_field_id(f)]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown metadata field id(s): {', '.join(unknown)}")


def _validate_custom_fields(custom_fields: dict[str, str]) -> None:
    if len(custom_fields) > _MAX_CUSTOM_FIELDS:
        raise HTTPException(status_code=422, detail=f"custom_fields is limited to {_MAX_CUSTOM_FIELDS} pairs")
    for key, value in custom_fields.items():
        if len(key) > _MAX_CUSTOM_FIELD_KEY_LEN or len(str(value)) > _MAX_CUSTOM_FIELD_VALUE_LEN:
            raise HTTPException(status_code=422, detail=f"custom_fields entry '{key}' is too long")


class WebhookCreate(BaseModel):
    name: str
    enabled: bool = True
    url: str
    secret: Optional[str] = None
    # Omit/null = fires for every lead on the website; set = scoped to that form only.
    form_id: Optional[int] = None
    # Standard conversation metadata (agent, device, tags, ...) to include on every
    # lead this webhook sends — see app.services.lead_metadata_fields.catalog().
    metadata_fields: list[str] = []
    # Static key/value pairs sent as-is on every lead from this webhook.
    custom_fields: dict[str, str] = {}


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    url: Optional[str] = None
    # Omit to keep the previously-saved secret; send "" explicitly to clear it.
    secret: Optional[str] = None
    # Sentinel: omit the field entirely to leave scoping unchanged; send
    # form_id explicitly (including null) to change it. Pydantic's
    # model_fields_set on the request body distinguishes "omitted" below.
    form_id: Optional[int] = None
    # Same omit-vs-explicit sentinel as form_id (checked via model_fields_set).
    metadata_fields: Optional[list[str]] = None
    custom_fields: Optional[dict[str, str]] = None


def _integration_to_dict(integration: WebsiteIntegration) -> dict:
    config = dict(integration.config or {})
    # Never echo the secret back once saved.
    has_secret = bool(config.pop("secret", None))
    return {
        "id": integration.id,
        "website_id": integration.website_id,
        "type": integration.type.value if hasattr(integration.type, "value") else integration.type,
        "name": integration.name,
        "enabled": integration.enabled,
        "form_id": integration.form_id,
        "form_name": integration.form.name if integration.form_id and integration.form else None,
        "config": {**config, "secret_set": has_secret},
        "created_at": integration.created_at.isoformat() if integration.created_at else None,
        "updated_at": integration.updated_at.isoformat() if integration.updated_at else None,
    }


@router.get("")
def list_integrations(
    website_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    return [_integration_to_dict(i) for i in integrations_repo.get_integrations(db, website_id)]


@router.get("/metadata-fields")
def list_metadata_fields(
    website_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Catalog of standard conversation metadata fields a webhook can be
    configured to include on every lead — powers the picker UI."""
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    from app.services.lead_metadata_fields import catalog

    return catalog()


@router.post("/webhooks")
def create_webhook(
    website_id: int,
    body: WebhookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)

    if not body.url.strip():
        raise HTTPException(status_code=422, detail="url is required")

    if body.form_id is not None:
        form = forms_repo.get_form_by_id(db, body.form_id)
        if not form or form.website_id != website_id:
            raise HTTPException(status_code=422, detail="Invalid form_id for this website")

    _validate_metadata_fields(body.metadata_fields)
    _validate_custom_fields(body.custom_fields)

    integration = integrations_repo.create_integration(
        db,
        website_id=website_id,
        type_=WebsiteIntegrationType.WEBHOOK,
        name=body.name.strip() or "Webhook",
        enabled=body.enabled,
        config={
            "url": body.url.strip(),
            "secret": (body.secret or None),
            "metadata_fields": body.metadata_fields,
            "custom_fields": body.custom_fields,
        },
        form_id=body.form_id,
    )
    return _integration_to_dict(integration)


@router.patch("/webhooks/{integration_id}")
def update_webhook(
    website_id: int,
    integration_id: int,
    body: WebhookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    integration = _require_webhook(db, website_id=website_id, integration_id=integration_id)

    config = dict(integration.config or {})
    if body.url is not None:
        if not body.url.strip():
            raise HTTPException(status_code=422, detail="url cannot be empty")
        config["url"] = body.url.strip()
    # Keep the previously-saved secret if the caller didn't send a new one
    # (frontend never receives it back, so a plain "save" without editing it
    # must not blank it out). Send an empty string explicitly to clear it.
    if body.secret is not None:
        config["secret"] = body.secret or None
    if "metadata_fields" in body.model_fields_set:
        fields = body.metadata_fields or []
        _validate_metadata_fields(fields)
        config["metadata_fields"] = fields
    if "custom_fields" in body.model_fields_set:
        custom = body.custom_fields or {}
        _validate_custom_fields(custom)
        config["custom_fields"] = custom

    form_id_kwargs = {}
    if "form_id" in body.model_fields_set:
        if body.form_id is not None:
            form = forms_repo.get_form_by_id(db, body.form_id)
            if not form or form.website_id != website_id:
                raise HTTPException(status_code=422, detail="Invalid form_id for this website")
        form_id_kwargs["form_id"] = body.form_id

    integration = integrations_repo.update_integration(
        db,
        integration,
        name=(body.name.strip() if body.name is not None else None),
        enabled=body.enabled,
        config=config,
        **form_id_kwargs,
    )
    return _integration_to_dict(integration)


@router.delete("/webhooks/{integration_id}")
def delete_webhook(
    website_id: int,
    integration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _require_website(website_id, db)
    _enforce_website_access(db, website_id=website_id, user=current_user)
    integration = _require_webhook(db, website_id=website_id, integration_id=integration_id)
    integrations_repo.delete_integration(db, integration)
    return {"success": True}
