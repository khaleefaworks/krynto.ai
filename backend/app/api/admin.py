from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_administrator
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.conversation import Conversation

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class OrgStats(BaseModel):
    id: int
    name: str
    slug: str
    plan: str
    is_active: bool
    owner_id: Optional[int] = None
    owner_verified: bool = True  # False = owner hasn't verified their email yet
    member_count: int
    website_count: int
    conversation_count: int


class OrgUpdateRequest(BaseModel):
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    name: Optional[str] = None


class AdminUserResponse(BaseModel):
    id: int
    name: Optional[str] = None
    email: str
    role: str
    is_active: bool
    organization_id: Optional[int] = None
    organization_name: Optional[str] = None


class PlatformStats(BaseModel):
    total_organizations: int
    active_organizations: int
    total_users: int
    total_websites: int
    total_conversations: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_org_stats(db: Session, org: Organization) -> OrgStats:
    member_count = (
        db.query(func.count(User.id))
        .filter(User.organization_id == org.id, User.is_deleted == False)
        .scalar()
        or 0
    )
    website_count = (
        db.query(func.count(Website.id))
        .filter(Website.organization_id == org.id)
        .scalar()
        or 0
    )
    conversation_count = 0
    if website_count:
        website_ids = [
            row[0] for row in db.query(Website.id).filter(Website.organization_id == org.id).all()
        ]
        conversation_count = (
            db.query(func.count(Conversation.id))
            .filter(Conversation.website_id.in_(website_ids))
            .scalar()
            or 0
        )
    return OrgStats(
        id=org.id,
        name=org.name,
        slug=org.slug,
        plan=org.plan,
        is_active=org.is_active,
        owner_id=org.owner_id,
        owner_verified=(
            db.query(User.is_email_verified)
            .filter(User.id == org.owner_id)
            .scalar()
            if org.owner_id else True
        ),
        member_count=member_count,
        website_count=website_count,
        conversation_count=conversation_count,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/organizations", response_model=List[OrgStats])
def list_organizations(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """List all organisations with basic stats. SYSTEM_MANAGER only."""
    orgs = db.query(Organization).order_by(Organization.name.asc(), Organization.id.asc()).all()
    return [_build_org_stats(db, org) for org in orgs]


@router.get("/organizations/{org_id}", response_model=OrgStats)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Get a single organisation with stats. SYSTEM_MANAGER only."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return _build_org_stats(db, org)


@router.patch("/organizations/{org_id}", response_model=OrgStats)
def update_organization(
    org_id: int,
    body: OrgUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Update organisation plan / active status / name. SYSTEM_MANAGER only."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if body.plan is not None:
        if body.plan not in ("free", "pro", "enterprise"):
            raise HTTPException(status_code=422, detail="Invalid plan value")
        org.plan = body.plan
    if body.is_active is not None:
        org.is_active = body.is_active
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Organisation name cannot be empty")
        org.name = name
    db.commit()
    db.refresh(org)
    return _build_org_stats(db, org)


@router.get("/users", response_model=List[AdminUserResponse])
def list_all_users(
    organization_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """List all users across all organisations. Optionally filter by org. SYSTEM_MANAGER only."""
    q = db.query(User, Organization.name.label("org_name")).outerjoin(
        Organization, Organization.id == User.organization_id
    ).filter(User.is_deleted == False)
    if organization_id is not None:
        q = q.filter(User.organization_id == organization_id)
    rows = q.order_by(User.email.asc()).all()
    return [
        AdminUserResponse(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role.value if hasattr(u.role, "value") else str(u.role),
            is_active=u.is_active,
            organization_id=u.organization_id,
            organization_name=org_name,
        )
        for u, org_name in rows
    ]


@router.get("/stats", response_model=PlatformStats)
def platform_stats(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """High-level platform metrics. SYSTEM_MANAGER only."""
    total_orgs = db.query(func.count(Organization.id)).scalar() or 0
    active_orgs = (
        db.query(func.count(Organization.id)).filter(Organization.is_active == True).scalar() or 0
    )
    total_users = (
        db.query(func.count(User.id)).filter(User.is_deleted == False).scalar() or 0
    )
    total_websites = db.query(func.count(Website.id)).scalar() or 0
    total_conversations = db.query(func.count(Conversation.id)).scalar() or 0
    return PlatformStats(
        total_organizations=total_orgs,
        active_organizations=active_orgs,
        total_users=total_users,
        total_websites=total_websites,
        total_conversations=total_conversations,
    )
