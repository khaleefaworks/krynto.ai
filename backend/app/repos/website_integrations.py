"""CRUD helpers for WebsiteIntegration."""

from __future__ import annotations

from typing import Optional
from sqlalchemy.orm import Session

from app.models.website_integration import WebsiteIntegration, WebsiteIntegrationType


def get_integrations(db: Session, website_id: int) -> list[WebsiteIntegration]:
    return (
        db.query(WebsiteIntegration)
        .filter(WebsiteIntegration.website_id == website_id)
        .order_by(WebsiteIntegration.id)
        .all()
    )


def get_integration_by_id(db: Session, integration_id: int) -> Optional[WebsiteIntegration]:
    return db.query(WebsiteIntegration).filter(WebsiteIntegration.id == integration_id).first()


def get_enabled_by_type(
    db: Session,
    website_id: int,
    type_: WebsiteIntegrationType,
    *,
    form_id: Optional[int] = None,
) -> list[WebsiteIntegration]:
    """Integrations with form_id=None fire for every lead on the website;
    integrations scoped to a form_id only fire for leads captured through
    that form. When form_id is None (e.g. the offline gate, which has no
    associated form), only unscoped integrations match."""
    query = db.query(WebsiteIntegration).filter(
        WebsiteIntegration.website_id == website_id,
        WebsiteIntegration.type == type_,
        WebsiteIntegration.enabled.is_(True),
    )
    if form_id is not None:
        query = query.filter(
            (WebsiteIntegration.form_id.is_(None)) | (WebsiteIntegration.form_id == form_id)
        )
    else:
        query = query.filter(WebsiteIntegration.form_id.is_(None))
    return query.all()


def has_enabled_integrations(db: Session, website_id: int) -> bool:
    return (
        db.query(WebsiteIntegration.id)
        .filter(
            WebsiteIntegration.website_id == website_id,
            WebsiteIntegration.enabled.is_(True),
        )
        .first()
        is not None
    )


def create_integration(
    db: Session,
    *,
    website_id: int,
    type_: WebsiteIntegrationType,
    name: str,
    enabled: bool,
    config: dict,
    form_id: Optional[int] = None,
) -> WebsiteIntegration:
    """A website can register any number of integrations of the same type —
    e.g. several independent webhooks — so this always inserts a new row
    rather than upserting by (website, type)."""
    integration = WebsiteIntegration(
        website_id=website_id, type=type_, name=name, enabled=enabled, config=config, form_id=form_id
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return integration


_UNSET = object()


def update_integration(
    db: Session,
    integration: WebsiteIntegration,
    *,
    name: Optional[str] = None,
    enabled: Optional[bool] = None,
    config: Optional[dict] = None,
    form_id: object = _UNSET,
) -> WebsiteIntegration:
    if name is not None:
        integration.name = name
    if enabled is not None:
        integration.enabled = enabled
    if config is not None:
        integration.config = config
    if form_id is not _UNSET:
        integration.form_id = form_id
    db.commit()
    db.refresh(integration)
    return integration


def delete_integration(db: Session, integration: WebsiteIntegration) -> None:
    db.delete(integration)
    db.commit()
