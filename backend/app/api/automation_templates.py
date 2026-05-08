from typing import List, Optional, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_admin, require_authenticated_user
from app.models.user import User
from app.models.automation_template import AutomationTemplate
from app.models.automation import Automation
from app.models.website import Website
from app.services.visibility import compute_visibility_scope, ensure_website_visible

router = APIRouter(prefix="/automation-templates", tags=["automation-templates"])


def _enforce_website_access(db: Session, *, website_id: int, user: User) -> None:
    scope = compute_visibility_scope(db, user=user)
    try:
        ensure_website_visible(scope, website_id=int(website_id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Website not assigned")


class TemplateResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    trigger: str
    category: str
    nodes: Optional[List[Any]] = None
    edges: Optional[List[Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UseTemplatePayload(BaseModel):
    website_id: int
    name: Optional[str] = None
    enabled: bool = True


class AutomationResponse(BaseModel):
    id: int
    website_id: int
    name: str
    trigger: str
    enabled: bool
    category: str
    nodes: Optional[List[Any]] = None
    edges: Optional[List[Any]] = None
    template_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=List[TemplateResponse])
def list_templates(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
):
    return db.query(AutomationTemplate).order_by(AutomationTemplate.id).all()


@router.post("/{template_id}/use", response_model=AutomationResponse)
def use_template(
    template_id: int,
    payload: UseTemplatePayload,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    template = db.query(AutomationTemplate).filter(AutomationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    website = db.query(Website).filter_by(id=payload.website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    _enforce_website_access(db, website_id=payload.website_id, user=_admin)

    import copy
    automation = Automation(
        website_id=payload.website_id,
        name=payload.name or template.name,
        trigger=template.trigger,
        enabled=payload.enabled,
        category=template.category,
        nodes=copy.deepcopy(template.nodes) if template.nodes else [],
        edges=copy.deepcopy(template.edges) if template.edges else [],
        template_id=template.id,
    )
    db.add(automation)
    db.commit()
    db.refresh(automation)
    return automation
