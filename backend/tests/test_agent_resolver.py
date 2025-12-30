from types import SimpleNamespace

from app.services.agent_resolver import is_agent_eligible


def test_agent_eligible_true_when_active_available_connected():
    user = SimpleNamespace(is_active=True, is_available=True)
    assert is_agent_eligible(user, True) is True


def test_agent_eligible_false_when_not_connected():
    user = SimpleNamespace(is_active=True, is_available=True)
    assert is_agent_eligible(user, False) is False


def test_agent_eligible_false_when_inactive():
    user = SimpleNamespace(is_active=False, is_available=True)
    assert is_agent_eligible(user, True) is False


def test_agent_eligible_false_when_unavailable():
    user = SimpleNamespace(is_active=True, is_available=False)
    assert is_agent_eligible(user, True) is False
