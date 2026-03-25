from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin, require_org_owner
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User, UserRole

router = APIRouter(prefix="/organization", tags=["organization"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class OrganizationResponse(BaseModel):
    id: int
    name: str
    slug: str
    plan: str
    is_active: bool
    owner_id: Optional[int] = None
    settings: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class OrganizationUpdateRequest(BaseModel):
    name: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class MemberResponse(BaseModel):
    id: int
    name: Optional[str] = None
    email: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_org_for_user(db: Session, current_user: User) -> Organization:
    if current_user.organization_id is None:
        raise HTTPException(status_code=404, detail="No organisation associated with this account")
    org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return org


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=OrganizationResponse)
def get_organization(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return the current user's organisation details."""
    return _get_org_for_user(db, current_user)


@router.patch("", response_model=OrganizationResponse)
def update_organization(
    body: OrganizationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_owner),
):
    """Update organisation name / settings. Requires OWNER."""
    org = _get_org_for_user(db, current_user)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Organisation name cannot be empty")
        org.name = name
    if body.settings is not None:
        org.settings = body.settings
    db.commit()
    db.refresh(org)
    return org


@router.get("/members", response_model=List[MemberResponse])
def list_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List all users that belong to the current user's organisation."""
    org = _get_org_for_user(db, current_user)
    users = (
        db.query(User)
        .filter(User.organization_id == org.id, User.is_deleted == False)
        .order_by(User.name.asc(), User.id.asc())
        .all()
    )
    return [
        MemberResponse(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role.value if hasattr(u.role, "value") else str(u.role),
            is_active=u.is_active,
        )
        for u in users
    ]
