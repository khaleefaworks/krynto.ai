from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import deps
from app.models.user import UserRole


def _user(role: UserRole):
    # Mimic the attributes deps.require_agent reads.
    return SimpleNamespace(role=role)


@pytest.mark.parametrize(
    "role",
    [UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER],
)
def test_require_agent_allows_agent_and_admin_roles(role: UserRole):
    assert deps.require_agent(current_user=_user(role)) is not None


def test_require_agent_rejects_unknown_role_value():
    # Simulate a corrupted/legacy DB value.
    with pytest.raises(HTTPException) as exc:
        deps.require_agent(current_user=SimpleNamespace(role="full_access"))
    assert exc.value.status_code == 403
