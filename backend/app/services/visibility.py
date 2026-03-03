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

    - website_ids: None means unrestricted (admins). Otherwise explicit allowed website ids.
    - team_ids: None means unrestricted (admins, or users with no team memberships).
      When set, only conversations assigned to one of these teams are visible.
      Conversations with team_id NULL are NOT visible to team-scoped users.
    """

    website_ids: Optional[list[int]]
    team_ids: Optional[list[int]]


def _unique_sorted_ints(values: Iterable[int]) -> list[int]:
    return sorted({int(v) for v in values})


def compute_visibility_scope(db: Session, *, user: User) -> VisibilityScope:
    # Only system_manager (Administrator) is unrestricted.
    # Managers are scoped to their assigned websites, same as agents.
    if user.is_administrator():
        return VisibilityScope(website_ids=None, team_ids=None)

    website_rows = (
        db.query(AgentWebsiteAssignment.website_id)
        .filter(AgentWebsiteAssignment.agent_id == int(user.id))
        .all()
    )
    website_ids = _unique_sorted_ints([int(r[0]) for r in website_rows])

    if not website_ids:
        return VisibilityScope(website_ids=[], team_ids=[])

    team_rows = (
        db.query(WebsiteTeamMember.team_id)
        .join(WebsiteTeam, WebsiteTeam.id == WebsiteTeamMember.team_id)
        .filter(WebsiteTeamMember.user_id == int(user.id))
        .filter(WebsiteTeam.website_id.in_(website_ids))
        .all()
    )
    team_ids = _unique_sorted_ints([int(r[0]) for r in team_rows])

    # If the user is not a member of any team, they can see all chats
    # for their assigned websites (team_ids=None means unrestricted).
    if not team_ids:
        return VisibilityScope(website_ids=website_ids, team_ids=None)

    return VisibilityScope(website_ids=website_ids, team_ids=team_ids)


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
