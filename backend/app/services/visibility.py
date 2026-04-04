from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.user import User
from app.models.website_team import WebsiteTeam, WebsiteTeamMember


@dataclass(frozen=True)
class VisibilityScope:
    """Computed visibility scope for a user.

    - organization_id: None means no org restriction (SYSTEM_MANAGER).
      For all other roles this is set to the user's org.
    - website_ids: None means unrestricted within the org (OWNER/MANAGER).
      When set, only the listed website IDs are visible (AGENT with assignments).
    - team_ids: None means unrestricted (no team membership constraint).
      When set, only conversations assigned to one of these teams are visible.
    """

    organization_id: Optional[int]
    website_ids: Optional[list[int]]
    team_ids: Optional[list[int]]


def _unique_sorted_ints(values: Iterable[int]) -> list[int]:
    return sorted({int(v) for v in values})


def compute_visibility_scope(db: Session, *, user: User) -> VisibilityScope:
    # SYSTEM_MANAGER sees everything across all orgs.
    if user.is_administrator():
        return VisibilityScope(organization_id=None, website_ids=None, team_ids=None)

    org_id: Optional[int] = user.organization_id

    # OWNER and MANAGER can see all websites within their org.
    if user.is_admin():  # includes OWNER and MANAGER
        return VisibilityScope(organization_id=org_id, website_ids=None, team_ids=None)

    # AGENT: scoped to assigned websites + optional team membership.
    website_rows = (
        db.query(AgentWebsiteAssignment.website_id)
        .filter(AgentWebsiteAssignment.agent_id == int(user.id))
        .all()
    )
    website_ids = _unique_sorted_ints([int(r[0]) for r in website_rows])

    if not website_ids:
        return VisibilityScope(organization_id=org_id, website_ids=[], team_ids=[])

    team_rows = (
        db.query(WebsiteTeamMember.team_id)
        .join(WebsiteTeam, WebsiteTeam.id == WebsiteTeamMember.team_id)
        .filter(WebsiteTeamMember.user_id == int(user.id))
        .filter(WebsiteTeam.website_id.in_(website_ids))
        .all()
    )
    team_ids = _unique_sorted_ints([int(r[0]) for r in team_rows])

    # No team membership → can see all chats for assigned websites (team_ids=None).
    if not team_ids:
        return VisibilityScope(organization_id=org_id, website_ids=website_ids, team_ids=None)

    return VisibilityScope(organization_id=org_id, website_ids=website_ids, team_ids=team_ids)


def ensure_website_visible(scope: VisibilityScope, *, website_id: int) -> None:
    if scope.website_ids is None:
        return
    if int(website_id) not in set(scope.website_ids):
        raise PermissionError("Website not assigned")


def conversation_team_filter_clause(sa, ConversationModel, *, scope: VisibilityScope):
    """Build a SQLAlchemy boolean clause for team visibility.

    - Admins / users with no team memberships: no clause (returns True literal)
    - Users with team memberships: only team_id IN their teams (excludes unassigned)
    """
    if scope.team_ids is None:
        return sa.true()

    allowed_team_ids = [int(t) for t in (scope.team_ids or [])]
    if not allowed_team_ids:
        # Edge case: empty list means see nothing team-scoped
        return sa.literal(False)

    return ConversationModel.team_id.in_(allowed_team_ids)
