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
    db: Session, website_id: int, type_: WebsiteIntegrationType
) -> list[WebsiteIntegration]:
    return (
        db.query(WebsiteIntegration)
        .filter(
            WebsiteIntegration.website_id == website_id,
            WebsiteIntegration.type == type_,
            WebsiteIntegration.enabled.is_(True),
        )
        .all()
    )


def create_integration(
    db: Session,
    *,
    website_id: int,
    type_: WebsiteIntegrationType,
    name: str,
    enabled: bool,
    config: dict,
) -> WebsiteIntegration:
    """A website can register any number of integrations of the same type —
    e.g. several independent webhooks — so this always inserts a new row
    rather than upserting by (website, type)."""
    integration = WebsiteIntegration(
        website_id=website_id, type=type_, name=name, enabled=enabled, config=config
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return integration


def update_integration(
    db: Session,
    integration: WebsiteIntegration,
    *,
    name: Optional[str] = None,
    enabled: Optional[bool] = None,
    config: Optional[dict] = None,
) -> WebsiteIntegration:
    if name is not None:
        integration.name = name
    if enabled is not None:
        integration.enabled = enabled
    if config is not None:
        integration.config = config
    db.commit()
    db.refresh(integration)
    return integration


def delete_integration(db: Session, integration: WebsiteIntegration) -> None:
    db.delete(integration)
    db.commit()
