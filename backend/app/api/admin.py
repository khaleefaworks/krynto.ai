from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_administrator
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.conversation import Conversation
from app.repos import security_events as security_events_repo

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


class SecurityEventResponse(BaseModel):
    id: int
    event_type: str
    actor_user_id: Optional[int] = None
    actor_email: Optional[str] = None
    target_user_id: Optional[int] = None
    target_email: Optional[str] = None
    organization_id: Optional[int] = None
    organization_name: Optional[str] = None
    ip_address: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


class SecurityEventListResponse(BaseModel):
    items: List[SecurityEventResponse]
    total: int


class SchedulerJobInfo(BaseModel):
    id: str
    name: str
    next_run_time: Optional[str] = None


class SystemHealthResponse(BaseModel):
    db: str
    redis: str
    active_agent_connections: int
    live_visitor_count: int
    scheduler_jobs: List[SchedulerJobInfo]


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
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Update organisation plan / active status / name. SYSTEM_MANAGER only."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")

    old_is_active = org.is_active
    old_plan = org.plan

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

    ip = request.client.host if request.client else None
    if body.is_active is not None and body.is_active != old_is_active:
        security_events_repo.log_security_event(
            db,
            event_type="org_reactivated" if body.is_active else "org_suspended",
            actor_user_id=_admin.id,
            organization_id=org.id,
            ip_address=ip,
        )
    if body.plan is not None and body.plan != old_plan:
        security_events_repo.log_security_event(
            db,
            event_type="org_plan_changed",
            actor_user_id=_admin.id,
            organization_id=org.id,
            ip_address=ip,
            metadata={"old_plan": old_plan, "new_plan": body.plan},
        )

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


@router.get("/security-events", response_model=SecurityEventListResponse)
def list_security_events(
    organization_id: Optional[int] = None,
    event_type: Optional[str] = None,
    actor_user_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Filterable security/activity event log. SYSTEM_MANAGER only."""
    limit = max(1, min(limit, 200))
    if date_from is None and date_to is None:
        date_from = datetime.now(timezone.utc) - timedelta(days=30)

    rows, total = security_events_repo.list_events(
        db,
        organization_id=organization_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )

    user_ids = {r.actor_user_id for r in rows if r.actor_user_id} | {
        r.target_user_id for r in rows if r.target_user_id
    }
    org_ids = {r.organization_id for r in rows if r.organization_id}
    users_by_id = (
        {u.id: u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if user_ids
        else {}
    )
    orgs_by_id = (
        {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(org_ids)).all()}
        if org_ids
        else {}
    )

    items = [
        SecurityEventResponse(
            id=r.id,
            event_type=r.event_type,
            actor_user_id=r.actor_user_id,
            actor_email=users_by_id.get(r.actor_user_id),
            target_user_id=r.target_user_id,
            target_email=users_by_id.get(r.target_user_id),
            organization_id=r.organization_id,
            organization_name=orgs_by_id.get(r.organization_id),
            ip_address=r.ip_address,
            metadata=r.event_metadata,
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]
    return SecurityEventListResponse(items=items, total=total)


@router.get("/system-health", response_model=SystemHealthResponse)
async def system_health(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_administrator),
):
    """Live platform system-health snapshot. SYSTEM_MANAGER only.

    Duplicates the DB/Redis checks from /health/ready (that endpoint is an
    unauthenticated k8s-style probe and stays that way) plus in-memory
    connection counts and scheduler job status not surfaced anywhere else.
    """
    from sqlalchemy import text as sa_text

    from app.core.config import settings
    from app.core.database import engine
    from app.services.agent_service import AgentService
    from app.services.presence_service import PresenceService
    from app.services.auto_close_scheduler import get_scheduler

    db_status = "ok"
    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
    except Exception:
        db_status = "error"

    redis_url = (getattr(settings, "REDIS_URL", "") or "").strip()
    redis_status = "disabled"
    if redis_url:
        try:
            import redis.asyncio as redis_asyncio

            client = redis_asyncio.from_url(redis_url, decode_responses=True)
            try:
                redis_status = "ok" if await client.ping() else "error"
            finally:
                await client.aclose()
        except Exception:
            redis_status = "error"

    active_agents = len(AgentService.connected_agent_ids())
    live_visitors = await PresenceService.total_connections()

    scheduler = get_scheduler()
    jobs: List[SchedulerJobInfo] = []
    if scheduler is not None:
        for job in scheduler.get_jobs():
            jobs.append(
                SchedulerJobInfo(
                    id=job.id,
                    name=job.name,
                    next_run_time=job.next_run_time.isoformat() if job.next_run_time else None,
                )
            )

    return SystemHealthResponse(
        db=db_status,
        redis=redis_status,
        active_agent_connections=active_agents,
        live_visitor_count=live_visitors,
        scheduler_jobs=jobs,
    )
