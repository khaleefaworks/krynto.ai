from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_authenticated_user, require_admin
from app.models.user import User
from app.repos import automations as automations_repo
from app.models.website import Website
from app.services.visibility import compute_visibility_scope, ensure_website_visible


def _enforce_website_access(db: Session, *, website_id: int, user: User) -> None:
    """Raise 403 if the user doesn't have visibility to this website."""
    scope = compute_visibility_scope(db, user=user)
    try:
        ensure_website_visible(scope, website_id=int(website_id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Website not assigned")

router = APIRouter(prefix="/automations", tags=["automations"])


class AutomationCreate(BaseModel):
    website_id: int
    name: str = Field(..., min_length=1, max_length=255)
    trigger: str = Field(..., min_length=1, max_length=100)
    enabled: bool = True
    category: str = Field('auto_message', max_length=50)
    conditions: dict | None = None
    actions: Any | None = None


class AutomationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    trigger: Optional[str] = Field(None, min_length=1, max_length=100)
    enabled: Optional[bool] = None
    category: Optional[str] = Field(None, max_length=50)
    conditions: Optional[dict] = None
    actions: Any | None = None


class AutomationResponse(BaseModel):
    id: int
    website_id: int
    name: str
    trigger: str
    enabled: bool
    category: str = 'auto_message'
    conditions: dict | None
    actions: Any | None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=List[AutomationResponse])
def list_automations(
    website_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
):
    """List automations for a website."""
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    _enforce_website_access(db, website_id=website_id, user=_current_user)

    return automations_repo.list_automations(db, website_id=website_id)


@router.post("", response_model=AutomationResponse, status_code=status.HTTP_201_CREATED)
def create_automation(
    payload: AutomationCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create an automation (Admin only)."""
    website = db.query(Website).filter_by(id=payload.website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    _enforce_website_access(db, website_id=payload.website_id, user=_admin)

    return automations_repo.create_automation(
        db,
        website_id=payload.website_id,
        name=payload.name,
        trigger=payload.trigger,
        enabled=payload.enabled,
        category=payload.category,
        conditions=payload.conditions,
        actions=payload.actions,
    )


@router.get("/{automation_id}", response_model=AutomationResponse)
def get_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
):
    automation = automations_repo.get_automation(db, automation_id=automation_id)
    if not automation:
        raise HTTPException(status_code=404, detail="Automation not found")
    _enforce_website_access(db, website_id=automation.website_id, user=_current_user)
    return automation


@router.put("/{automation_id}", response_model=AutomationResponse)
def update_automation(
    automation_id: int,
    payload: AutomationUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    automation = automations_repo.get_automation(db, automation_id=automation_id)
    if not automation:
        raise HTTPException(status_code=404, detail="Automation not found")
    _enforce_website_access(db, website_id=automation.website_id, user=_admin)

    return automations_repo.update_automation(
        db,
        automation=automation,
        name=payload.name,
        trigger=payload.trigger,
        enabled=payload.enabled,
        category=payload.category,
        conditions=payload.conditions,
        actions=payload.actions,
    )


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    automation = automations_repo.get_automation(db, automation_id=automation_id)
    if not automation:
        raise HTTPException(status_code=404, detail="Automation not found")
    _enforce_website_access(db, website_id=automation.website_id, user=_admin)

    automations_repo.delete_automation(db, automation=automation)
    return None
