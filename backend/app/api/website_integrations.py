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


class WebhookCreate(BaseModel):
    name: str
    enabled: bool = True
    url: str
    secret: Optional[str] = None


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    url: Optional[str] = None
    # Omit to keep the previously-saved secret; send "" explicitly to clear it.
    secret: Optional[str] = None


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

    integration = integrations_repo.create_integration(
        db,
        website_id=website_id,
        type_=WebsiteIntegrationType.WEBHOOK,
        name=body.name.strip() or "Webhook",
        enabled=body.enabled,
        config={"url": body.url.strip(), "secret": (body.secret or None)},
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

    integration = integrations_repo.update_integration(
        db,
        integration,
        name=(body.name.strip() if body.name is not None else None),
        enabled=body.enabled,
        config=config,
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
