from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.database import get_db
from app.models.user import User
from app.models.website import Website
from app.models.website_team import WebsiteTeam, WebsiteTeamMember
from app.services.visibility import compute_visibility_scope, ensure_website_visible


router = APIRouter(prefix="/websites/{website_id}/teams", tags=["website_teams"])


class TeamResponse(BaseModel):
    id: int
    website_id: int
    name: str
    description: Optional[str] = None
    member_count: int = 0


class TeamCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class TeamMembersResponse(BaseModel):
    team_id: int
    user_ids: List[int]


class TeamMembersUpdateRequest(BaseModel):
    user_ids: List[int]


def _get_website_or_404(db: Session, website_id: int) -> Website:
    website = db.query(Website).filter(Website.id == int(website_id)).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


def _enforce_website_access(db: Session, *, website_id: int, user: User) -> None:
    """Raise 403 if the user doesn't have visibility to this website."""
    scope = compute_visibility_scope(db, user=user)
    try:
        ensure_website_visible(scope, website_id=int(website_id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Website not assigned")


def _get_team_or_404(db: Session, *, website_id: int, team_id: int) -> WebsiteTeam:
    team = (
        db.query(WebsiteTeam)
        .filter(WebsiteTeam.id == int(team_id), WebsiteTeam.website_id == int(website_id))
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("", response_model=List[TeamResponse])
def list_teams(
    website_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _get_website_or_404(db, website_id)
    _enforce_website_access(db, website_id=website_id, user=_admin)

    teams = (
        db.query(WebsiteTeam)
        .filter(WebsiteTeam.website_id == int(website_id))
        .order_by(WebsiteTeam.name.asc(), WebsiteTeam.id.asc())
        .all()
    )

    # Member counts in one query.
    team_ids = [int(t.id) for t in teams]
    counts: dict[int, int] = {}
    if team_ids:
        rows = (
            db.query(WebsiteTeamMember.team_id, WebsiteTeamMember.id)
            .filter(WebsiteTeamMember.team_id.in_(team_ids))
            .all()
        )
        for team_id_val, _member_id in rows:
            tid = int(team_id_val)
            counts[tid] = counts.get(tid, 0) + 1

    return [
        TeamResponse(
            id=int(t.id),
            website_id=int(t.website_id),
            name=str(t.name),
            description=getattr(t, "description", None),
            member_count=int(counts.get(int(t.id), 0)),
        )
        for t in teams
    ]


@router.post("", response_model=TeamResponse)
def create_team(
    website_id: int,
    payload: TeamCreateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _get_website_or_404(db, website_id)
    _enforce_website_access(db, website_id=website_id, user=_admin)

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required")

    existing = (
        db.query(WebsiteTeam)
        .filter(WebsiteTeam.website_id == int(website_id), WebsiteTeam.name == name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="A team with that name already exists")

    team = WebsiteTeam(website_id=int(website_id), name=name, description=payload.description)
    db.add(team)
    db.commit()
    db.refresh(team)

    return TeamResponse(
        id=int(team.id),
        website_id=int(team.website_id),
        name=str(team.name),
        description=getattr(team, "description", None),
        member_count=0,
    )


@router.put("/{team_id}", response_model=TeamResponse)
def update_team(
    website_id: int,
    team_id: int,
    payload: TeamUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _enforce_website_access(db, website_id=website_id, user=_admin)
    team = _get_team_or_404(db, website_id=website_id, team_id=team_id)

    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="Team name cannot be empty")
        if next_name != team.name:
            clash = (
                db.query(WebsiteTeam)
                .filter(WebsiteTeam.website_id == int(website_id), WebsiteTeam.name == next_name)
                .first()
            )
            if clash:
                raise HTTPException(status_code=409, detail="A team with that name already exists")
        team.name = next_name

    if payload.description is not None:
        team.description = payload.description

    db.commit()
    db.refresh(team)

    member_count = (
        db.query(WebsiteTeamMember)
        .filter(WebsiteTeamMember.team_id == int(team.id))
        .count()
    )

    return TeamResponse(
        id=int(team.id),
        website_id=int(team.website_id),
        name=str(team.name),
        description=getattr(team, "description", None),
        member_count=int(member_count or 0),
    )


@router.delete("/{team_id}")
def delete_team(
    website_id: int,
    team_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _enforce_website_access(db, website_id=website_id, user=_admin)
    team = _get_team_or_404(db, website_id=website_id, team_id=team_id)

    db.delete(team)
    db.commit()

    return {"success": True}


@router.get("/{team_id}/members", response_model=TeamMembersResponse)
def get_team_members(
    website_id: int,
    team_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _enforce_website_access(db, website_id=website_id, user=_admin)
    team = _get_team_or_404(db, website_id=website_id, team_id=team_id)

    rows = (
        db.query(WebsiteTeamMember.user_id)
        .filter(WebsiteTeamMember.team_id == int(team.id))
        .order_by(WebsiteTeamMember.user_id.asc())
        .all()
    )
    user_ids = [int(r[0]) for r in rows]

    return TeamMembersResponse(team_id=int(team.id), user_ids=user_ids)


@router.put("/{team_id}/members", response_model=TeamMembersResponse)
def set_team_members(
    website_id: int,
    team_id: int,
    payload: TeamMembersUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    _enforce_website_access(db, website_id=website_id, user=_admin)
    team = _get_team_or_404(db, website_id=website_id, team_id=team_id)

    next_ids = sorted({int(x) for x in (payload.user_ids or [])})

    # Replace membership (simpler + deterministic).
    db.query(WebsiteTeamMember).filter(WebsiteTeamMember.team_id == int(team.id)).delete()

    for uid in next_ids:
        db.add(WebsiteTeamMember(team_id=int(team.id), user_id=int(uid)))

    db.commit()

    return TeamMembersResponse(team_id=int(team.id), user_ids=next_ids)
