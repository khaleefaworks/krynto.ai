from __future__ import annotations

from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_authenticated_user
from app.core.database import get_db
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.website_team import WebsiteTeam, WebsiteTeamMember
from app.repos import users as users_repo
from app.services.agent_resolver import is_agent_eligible
from app.services.agent_service import AgentService
from app.services.visibility import compute_visibility_scope


router = APIRouter(prefix="/teams", tags=["teams"])


class AgentAvailability(BaseModel):
    id: int
    name: str
    email: str
    role: str
    avatar_url: Optional[str] = None
    is_active: bool
    is_available: bool
    is_connected: bool
    can_receive_chats: bool


class TeamOverview(BaseModel):
    id: int
    website_id: int
    name: str
    description: Optional[str] = None
    agents: List[AgentAvailability]


class WebsiteTeamsOverview(BaseModel):
    id: int
    name: str
    domain: Optional[str] = None
    teams: List[TeamOverview]
    unassigned_agents: List[AgentAvailability]
    assigned_agents_count: int
    available_agents_count: int


def _role_value(user: User) -> str:
    role = getattr(user, "role", None)
    return str(getattr(role, "value", role) or "")


def _agent_row(user: User, *, connected_user_ids: Set[int]) -> AgentAvailability:
    is_connected = int(user.id) in connected_user_ids
    can_receive = is_agent_eligible(user, is_connected)
    return AgentAvailability(
        id=int(user.id),
        name=str(user.name or ""),
        email=str(user.email or ""),
        role=_role_value(user),
        avatar_url=getattr(user, "avatar_url", None),
        is_active=bool(getattr(user, "is_active", False)),
        is_available=bool(getattr(user, "is_available", False)),
        is_connected=bool(is_connected),
        can_receive_chats=bool(can_receive),
    )


@router.get("/overview", response_model=List[WebsiteTeamsOverview])
def get_teams_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Return a permission-scoped overview of agent availability per website.

    Rules:
    - Admins/managers: see all websites
    - Agents: see only websites they are assigned to

    Availability is derived from:
    - user.is_active (DB)
    - user.is_available (DB toggle)
    - user.last_heartbeat_at (DB-backed presence via TTL)
    """

    scope = compute_visibility_scope(db, user=current_user)

    websites_q = db.query(Website)
    if scope.organization_id is not None:
        websites_q = websites_q.filter(Website.organization_id == scope.organization_id)
    if scope.website_ids is not None:
        website_ids = [int(w) for w in (scope.website_ids or [])]
        if not website_ids:
            return []
        websites_q = websites_q.filter(Website.id.in_(website_ids))

    websites = (
        websites_q.order_by(Website.name.asc(), Website.id.asc()).all()
    )

    website_ids = [int(w.id) for w in websites]
    if not website_ids:
        return []

    assignment_rows = (
        db.query(AgentWebsiteAssignment.website_id, AgentWebsiteAssignment.agent_id)
        .filter(AgentWebsiteAssignment.website_id.in_(website_ids))
        .all()
    )

    agent_ids_by_website: Dict[int, Set[int]] = {wid: set() for wid in website_ids}
    all_agent_ids: Set[int] = set()
    for website_id, agent_id in assignment_rows:
        wid = int(website_id)
        aid = int(agent_id)
        agent_ids_by_website.setdefault(wid, set()).add(aid)
        all_agent_ids.add(aid)

    agents: List[User] = []
    if all_agent_ids:
        agents = (
            db.query(User)
            .filter(User.id.in_(sorted(all_agent_ids)))
            .filter(User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER]))
            .order_by(User.name.asc(), User.id.asc())
            .all()
        )

    agent_by_id: Dict[int, User] = {int(u.id): u for u in agents}

    connected_user_ids = users_repo.recently_heartbeat_user_ids(
        db,
        ttl_seconds=AgentService.heartbeat_ttl_seconds,
    )

    teams = (
        db.query(WebsiteTeam)
        .filter(WebsiteTeam.website_id.in_(website_ids))
        .order_by(WebsiteTeam.name.asc(), WebsiteTeam.id.asc())
        .all()
    )

    teams_by_website: Dict[int, List[WebsiteTeam]] = {wid: [] for wid in website_ids}
    for t in teams:
        teams_by_website.setdefault(int(t.website_id), []).append(t)

    member_rows = (
        db.query(WebsiteTeam.website_id, WebsiteTeamMember.team_id, WebsiteTeamMember.user_id)
        .join(WebsiteTeam, WebsiteTeam.id == WebsiteTeamMember.team_id)
        .filter(WebsiteTeam.website_id.in_(website_ids))
        .all()
    )

    members_by_team: Dict[int, Set[int]] = {}
    for website_id, team_id, user_id in member_rows:
        tid = int(team_id)
        uid = int(user_id)
        members_by_team.setdefault(tid, set()).add(uid)

    result: List[WebsiteTeamsOverview] = []

    for website in websites:
        wid = int(website.id)
        assigned_agent_ids = sorted(agent_ids_by_website.get(wid, set()))

        # Only show users that are assigned to the website.
        assigned_users: List[User] = [
            agent_by_id[aid]
            for aid in assigned_agent_ids
            if aid in agent_by_id
        ]

        team_overviews: List[TeamOverview] = []
        in_any_team: Set[int] = set()

        for team in teams_by_website.get(wid, []):
            tid = int(team.id)
            member_ids = sorted(members_by_team.get(tid, set()))

            team_agents: List[AgentAvailability] = []
            for uid in member_ids:
                if uid not in set(assigned_agent_ids):
                    continue
                u = agent_by_id.get(uid)
                if not u:
                    continue
                in_any_team.add(uid)
                team_agents.append(_agent_row(u, connected_user_ids=connected_user_ids))

            team_overviews.append(
                TeamOverview(
                    id=int(team.id),
                    website_id=int(team.website_id),
                    name=str(team.name),
                    description=getattr(team, "description", None),
                    agents=team_agents,
                )
            )

        unassigned_agents: List[AgentAvailability] = []
        for u in assigned_users:
            uid = int(u.id)
            if uid in in_any_team:
                continue
            unassigned_agents.append(_agent_row(u, connected_user_ids=connected_user_ids))

        available_agents_count = sum(1 for u in assigned_users if is_agent_eligible(u, int(u.id) in connected_user_ids))

        result.append(
            WebsiteTeamsOverview(
                id=int(website.id),
                name=str(website.name),
                domain=getattr(website, "domain", None),
                teams=team_overviews,
                unassigned_agents=unassigned_agents,
                assigned_agents_count=len(assigned_users),
                available_agents_count=int(available_agents_count),
            )
        )

    return result
