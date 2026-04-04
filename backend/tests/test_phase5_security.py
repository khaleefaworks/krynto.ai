"""
Phase 5 — Security & Lifecycle Tests

Covers:
 1. Cross-org data isolation (Org A user cannot see Org B resources)
 2. SYSTEM_MANAGER bypass (super-admin sees all orgs)
 3. JWT invalidation on password change
 4. Org deactivation blocks login + API access
 5. Password-reset token expiry, reuse, email enumeration
 6. Password reset invalidates prior sessions
 7. Signup happy-path (org + owner creation)
 8. Conversation lifecycle: resolved → visitor returns → new conversation (not reopened)
 9. Visitor close → resolved with closed_by='visitor'
10. Agent close → resolved with closed_by='agent'
11. Register rejects OWNER role
12. Agent scoped to assigned websites only
"""
import hashlib
import time
from datetime import datetime, timedelta, timezone

import pytest


# ---------------------------------------------------------------------------
# Fixture: two organisations, users across orgs, websites, system_manager
# ---------------------------------------------------------------------------

@pytest.fixture()
def multi_org_env():
    """
    Seed a two-org environment with:
      - SystemSettings (is_initialized=True)
      - Org A (id=1) with owner (id=10), agent (id=11), website (id=100)
      - Org B (id=2) with owner (id=20), agent (id=21), website (id=200)
      - SYSTEM_MANAGER (id=1, org=NULL)
      - Agent 11 assigned to website 100
      - Agent 21 assigned to website 200
    """
    from fastapi.testclient import TestClient

    from app.main import app
    from app.core.database import Base, engine, init_db, SessionLocal
    from app.core.security import get_password_hash
    from app.models.user import User, UserRole
    from app.models.organization import Organization
    from app.models.website import Website
    from app.models.system_settings import SystemSettings
    from app.models.agent_website_assignment import AgentWebsiteAssignment

    # Clean slate: drop + recreate all tables to prevent state leakage.
    from app import models  # noqa: F401 — ensure metadata is complete
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    try:
        # System settings
        db.add(SystemSettings(id=1, is_initialized=True))
        db.flush()

        # Organisations
        db.add(Organization(id=1, name="Org A", slug="org-a", plan="free", is_active=True))
        db.add(Organization(id=2, name="Org B", slug="org-b", plan="free", is_active=True))
        db.flush()

        password_hash = get_password_hash("testpass123")

        # SYSTEM_MANAGER (no org)
        db.add(User(
            id=1, name="Super Admin", email="superadmin@chatassist.io",
            password_hash=password_hash, role=UserRole.SYSTEM_MANAGER,
            is_active=True, is_available=True, is_email_verified=True,
        ))

        # Org A users
        db.add(User(
            id=10, name="Owner A", email="owner-a@acme.com",
            password_hash=password_hash, role=UserRole.OWNER,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.add(User(
            id=11, name="Agent A", email="agent-a@acme.com",
            password_hash=password_hash, role=UserRole.AGENT,
            organization_id=1, is_active=True, is_available=True, is_email_verified=True,
        ))

        # Org B users
        db.add(User(
            id=20, name="Owner B", email="owner-b@globex.com",
            password_hash=password_hash, role=UserRole.OWNER,
            organization_id=2, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.add(User(
            id=21, name="Agent B", email="agent-b@globex.com",
            password_hash=password_hash, role=UserRole.AGENT,
            organization_id=2, is_active=True, is_available=True, is_email_verified=True,
        ))
        db.flush()

        # Websites
        db.add(Website(id=100, name="Site A", domain="site-a.test", organization_id=1))
        db.add(Website(id=200, name="Site B", domain="site-b.test", organization_id=2))
        db.flush()

        # Agent assignments
        db.add(AgentWebsiteAssignment(agent_id=11, website_id=100))
        db.add(AgentWebsiteAssignment(agent_id=21, website_id=200))

        # Set org owners
        db.query(Organization).filter_by(id=1).update({"owner_id": 10})
        db.query(Organization).filter_by(id=2).update({"owner_id": 20})

        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        yield client

    # Cleanup: drop all tables so subsequent test files start with a clean init_db().
    Base.metadata.drop_all(bind=engine)


def _auth(user_id: int) -> dict:
    """Return Authorization header dict for the given user_id."""
    from app.core.security import create_access_token
    token = create_access_token({"user_id": user_id})
    return {"Authorization": f"Bearer {token}"}


# ===================================================================
# 1. Cross-org data isolation
# ===================================================================

class TestCrossOrgIsolation:
    """Org A users must not see Org B resources and vice versa."""

    def test_owner_a_cannot_list_org_b_websites(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/websites", headers=_auth(10))
        assert resp.status_code == 200
        websites = resp.json()
        # Should only see Org A websites
        for w in websites:
            assert w["id"] != 200, "Org A owner should not see Org B website"

    def test_owner_b_cannot_list_org_a_websites(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/websites", headers=_auth(20))
        assert resp.status_code == 200
        websites = resp.json()
        for w in websites:
            assert w["id"] != 100, "Org B owner should not see Org A website"

    def test_owner_a_cannot_get_org_b_website_detail(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/websites/200", headers=_auth(10))
        assert resp.status_code in (403, 404)

    def test_owner_a_cannot_list_org_b_users(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/users", headers=_auth(10))
        assert resp.status_code == 200
        user_ids = [u["id"] for u in resp.json()]
        assert 20 not in user_ids, "Org A should not see Org B owner"
        assert 21 not in user_ids, "Org A should not see Org B agent"

    def test_agent_a_cannot_see_org_b_websites(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/websites", headers=_auth(11))
        assert resp.status_code == 200
        website_ids = [w["id"] for w in resp.json()]
        assert 200 not in website_ids


# ===================================================================
# 2. SYSTEM_MANAGER super-admin bypass
# ===================================================================

class TestSuperAdminBypass:
    """SYSTEM_MANAGER sees all orgs, users, and websites."""

    def test_super_admin_sees_all_websites(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/websites", headers=_auth(1))
        assert resp.status_code == 200
        website_ids = {w["id"] for w in resp.json()}
        assert 100 in website_ids, "Super-admin must see Org A website"
        assert 200 in website_ids, "Super-admin must see Org B website"

    def test_super_admin_sees_all_users(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/users", headers=_auth(1))
        assert resp.status_code == 200
        user_ids = {u["id"] for u in resp.json()}
        assert 10 in user_ids
        assert 20 in user_ids

    def test_super_admin_can_list_organizations(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/admin/organizations", headers=_auth(1))
        assert resp.status_code == 200
        org_ids = {o["id"] for o in resp.json()}
        assert 1 in org_ids
        assert 2 in org_ids

    def test_non_superadmin_cannot_list_organizations(self, multi_org_env):
        client = multi_org_env
        resp = client.get("/admin/organizations", headers=_auth(10))
        assert resp.status_code == 403


# ===================================================================
# 3. JWT invalidation on password change
# ===================================================================

class TestPasswordChangeInvalidatesTokens:

    def test_old_token_rejected_after_password_change(self, multi_org_env):
        """A token issued BEFORE password_changed_at must be rejected."""
        from app.core.database import SessionLocal
        from app.models.user import User

        client = multi_org_env

        # Issue token now
        old_headers = _auth(10)

        # Verify it works
        resp = client.get("/websites", headers=old_headers)
        assert resp.status_code == 200

        # Simulate password change
        time.sleep(1)  # ensure timestamp difference
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(id=10).first()
            user.password_changed_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

        # Old token should now be rejected
        resp = client.get("/websites", headers=old_headers)
        assert resp.status_code == 401
        assert "password change" in resp.json()["detail"].lower()


# ===================================================================
# 4. Org deactivation blocks login + API access
# ===================================================================

class TestOrgDeactivation:

    def test_login_blocked_when_org_inactive(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.organization import Organization

        client = multi_org_env

        # Deactivate Org A
        db = SessionLocal()
        try:
            db.query(Organization).filter_by(id=1).update({"is_active": False})
            db.commit()
        finally:
            db.close()

        resp = client.post("/auth/login", json={
            "email": "owner-a@acme.com",
            "password": "testpass123",
        })
        assert resp.status_code == 403
        assert "deactivated" in resp.json()["detail"].lower()

    def test_api_blocked_when_org_inactive(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.organization import Organization

        client = multi_org_env

        headers = _auth(10)

        # Deactivate Org A
        db = SessionLocal()
        try:
            db.query(Organization).filter_by(id=1).update({"is_active": False})
            db.commit()
        finally:
            db.close()

        resp = client.get("/websites", headers=headers)
        assert resp.status_code == 403
        assert "inactive" in resp.json()["detail"].lower()


# ===================================================================
# 5. Password-reset token: expiry, reuse, email enumeration
# ===================================================================

class TestPasswordReset:

    def test_forgot_password_always_200(self, multi_org_env):
        """Must not reveal whether the email exists."""
        client = multi_org_env
        for email in ["owner-a@acme.com", "nonexistent@nowhere.org"]:
            resp = client.post("/auth/forgot-password", json={"email": email})
            assert resp.status_code == 200

    def test_reset_with_invalid_token(self, multi_org_env):
        client = multi_org_env
        resp = client.post("/auth/reset-password", json={
            "token": "completely-bogus-token",
            "new_password": "newpass456",
        })
        assert resp.status_code == 400

    def test_reset_token_reuse_rejected(self, multi_org_env):
        """Once consumed, the same token must not work again."""
        from app.core.database import SessionLocal
        from app.models.password_reset_token import PasswordResetToken
        from app.models.user import User
        import secrets

        client = multi_org_env

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        db = SessionLocal()
        try:
            db.add(PasswordResetToken(
                user_id=10,
                token_hash=token_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ))
            db.commit()
        finally:
            db.close()

        # First use — should succeed
        resp = client.post("/auth/reset-password", json={
            "token": raw_token,
            "new_password": "newpass456",
        })
        assert resp.status_code == 200

        # Second use — must fail
        resp = client.post("/auth/reset-password", json={
            "token": raw_token,
            "new_password": "anotherpass789",
        })
        assert resp.status_code == 400
        assert "used" in resp.json()["detail"].lower()

    def test_reset_expired_token_rejected(self, multi_org_env):
        """Expired tokens must be rejected."""
        from app.core.database import SessionLocal
        from app.models.password_reset_token import PasswordResetToken
        import secrets

        client = multi_org_env

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        db = SessionLocal()
        try:
            db.add(PasswordResetToken(
                user_id=10,
                token_hash=token_hash,
                expires_at=datetime.now(timezone.utc) - timedelta(hours=1),  # already expired
            ))
            db.commit()
        finally:
            db.close()

        resp = client.post("/auth/reset-password", json={
            "token": raw_token,
            "new_password": "newpass456",
        })
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()


# ===================================================================
# 6. Password reset invalidates prior sessions
# ===================================================================

class TestPasswordResetInvalidatesSessions:

    def test_old_token_rejected_after_password_reset(self, multi_org_env):
        """After reset-password, previously issued JWTs must be rejected."""
        from app.core.database import SessionLocal
        from app.models.password_reset_token import PasswordResetToken
        import secrets

        client = multi_org_env

        # Get a valid token first
        old_headers = _auth(20)
        resp = client.get("/websites", headers=old_headers)
        assert resp.status_code == 200

        # Create a reset token and consume it
        time.sleep(1)
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        db = SessionLocal()
        try:
            db.add(PasswordResetToken(
                user_id=20,
                token_hash=token_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ))
            db.commit()
        finally:
            db.close()

        resp = client.post("/auth/reset-password", json={
            "token": raw_token,
            "new_password": "resetpass123",
        })
        assert resp.status_code == 200

        # Old JWT should now be rejected
        resp = client.get("/websites", headers=old_headers)
        assert resp.status_code == 401
        assert "password change" in resp.json()["detail"].lower()


# ===================================================================
# 7. Signup happy-path
# ===================================================================

class TestSignupFlow:

    def test_signup_creates_org_and_owner(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.user import User
        from app.models.organization import Organization

        client = multi_org_env

        resp = client.post("/auth/signup", json={
            "name": "New User",
            "email": "newuser@brandneworg.com",
            "password": "signup123",
            "organization_name": "Brand New Org",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["needs_verification"] is True
        assert data["email"] == "newuser@brandneworg.com"

        # Verify in DB
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(email="newuser@brandneworg.com").first()
            assert user is not None
            assert user.role.value == "owner"
            assert user.is_email_verified is False

            org = db.query(Organization).filter_by(id=user.organization_id).first()
            assert org is not None
            assert org.name == "Brand New Org"
            assert org.owner_id == user.id
        finally:
            db.close()

    def test_signup_duplicate_email_rejected(self, multi_org_env):
        client = multi_org_env
        resp = client.post("/auth/signup", json={
            "name": "Dup User",
            "email": "owner-a@acme.com",  # already exists
            "password": "signup123",
            "organization_name": "Dup Org",
        })
        assert resp.status_code == 400
        assert "already registered" in resp.json()["detail"].lower()


# ===================================================================
# 8. Conversation lifecycle: resolved → visitor returns → new conversation
# ===================================================================

class TestConversationLifecycle:

    def test_resolved_conversation_not_reopened(self, multi_org_env):
        """A visitor returning after resolution must get a new OPEN conversation,
        not a reopened old one."""
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation, ConversationStatus

        client = multi_org_env

        session_id = "visitor-lifecycle-test"
        website_id = 100

        # Create first conversation via widget
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        conv1_id = resp.json()["conversation_id"]

        # Resolve it directly in DB (simulating agent close)
        db = SessionLocal()
        try:
            conv = db.query(Conversation).filter_by(id=conv1_id).first()
            conv.status = ConversationStatus.RESOLVED
            conv.closed_by = "agent"
            db.commit()
        finally:
            db.close()

        # Visitor returns — create new conversation
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        conv2_id = resp.json()["conversation_id"]

        assert conv2_id != conv1_id, "Must be a NEW conversation, not reopened"

        # Verify in DB
        db = SessionLocal()
        try:
            old_conv = db.query(Conversation).filter_by(id=conv1_id).first()
            assert old_conv.status == ConversationStatus.RESOLVED

            new_conv = db.query(Conversation).filter_by(id=conv2_id).first()
            assert new_conv.status == ConversationStatus.OPEN
        finally:
            db.close()

    def test_duplicate_open_conversation_rejected(self, multi_org_env):
        """Creating a new conversation when one is already OPEN must return 409."""
        client = multi_org_env
        session_id = "visitor-409-test"
        website_id = 100

        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201

        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 409


# ===================================================================
# 9. Widget end-chat → resolved with closed_by='visitor'
# ===================================================================

class TestVisitorEndChat:

    def test_visitor_close_resolves_with_closed_by_visitor(self, multi_org_env):
        """Simulates a visitor closing the chat — conversation must resolve with closed_by='visitor'."""
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation, ConversationStatus

        client = multi_org_env
        session_id = "visitor-endchat-test"
        website_id = 100

        # Create conversation
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        conv_id = resp.json()["conversation_id"]

        # Simulate visitor closing chat (normally via WebSocket end_chat message)
        # by directly calling the service layer.
        db = SessionLocal()
        try:
            from app.services.conversation_service import ConversationService
            svc = ConversationService(db)
            conv = svc.close_conversation(conv_id, closed_by="visitor")
            assert conv is not None
            assert conv.status == ConversationStatus.RESOLVED
            assert conv.closed_by == "visitor"
        finally:
            db.close()


# ===================================================================
# 10. Agent close → resolved with closed_by='agent'
# ===================================================================

class TestAgentClose:

    def test_agent_close_sets_closed_by_agent(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation, ConversationStatus

        client = multi_org_env
        session_id = "agent-close-test"
        website_id = 100

        # Create conversation
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        conv_id = resp.json()["conversation_id"]

        # Assign agent to conversation (so they can close it)
        db = SessionLocal()
        try:
            conv = db.query(Conversation).filter_by(id=conv_id).first()
            conv.assigned_agent_id = 11
            db.commit()
        finally:
            db.close()

        # Agent closes via API
        resp = client.post(
            f"/chats/{conv_id}/close",
            headers=_auth(11),
        )
        assert resp.status_code == 200

        # Verify
        db = SessionLocal()
        try:
            conv = db.query(Conversation).filter_by(id=conv_id).first()
            assert conv.status == ConversationStatus.RESOLVED
            assert conv.closed_by == "agent"
        finally:
            db.close()


# ===================================================================
# 11. Register rejects OWNER role
# ===================================================================

class TestRegisterRoleRestrictions:

    def test_register_rejects_owner_role(self, multi_org_env):
        client = multi_org_env
        resp = client.post(
            "/auth/register",
            headers=_auth(10),  # Owner A (admin)
            json={
                "name": "Sneaky Owner",
                "email": "sneaky@acme.com",
                "password": "secret123",
                "role": "owner",
            },
        )
        assert resp.status_code == 400
        assert "bootstrap" in resp.json()["detail"].lower()

    def test_register_rejects_system_manager_role(self, multi_org_env):
        client = multi_org_env
        resp = client.post(
            "/auth/register",
            headers=_auth(1),  # Super admin
            json={
                "name": "Sneaky SM",
                "email": "sneaky-sm@acme.com",
                "password": "secret123",
                "role": "system_manager",
            },
        )
        assert resp.status_code == 400


# ===================================================================
# 12. Agent scoped to assigned websites only
# ===================================================================

class TestAgentWebsiteScope:

    def test_agent_only_sees_assigned_websites(self, multi_org_env):
        """Agent A (assigned to website 100) should not see website 200."""
        client = multi_org_env
        resp = client.get("/websites", headers=_auth(11))
        assert resp.status_code == 200
        website_ids = [w["id"] for w in resp.json()]
        assert 100 in website_ids
        assert 200 not in website_ids

    def test_agent_cannot_access_unassigned_website_detail(self, multi_org_env):
        """Agent A should get 403 when accessing Org B's website detail."""
        client = multi_org_env
        resp = client.get("/websites/200", headers=_auth(11))
        assert resp.status_code in (403, 404)


# ===================================================================
# 13. Widget conversations list: active + history separation
# ===================================================================

class TestWidgetConversationsList:

    def test_active_and_history_separation(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.conversation import Conversation, ConversationStatus

        client = multi_org_env
        session_id = "conv-list-test"
        website_id = 100

        # Create and resolve a conversation
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        old_conv_id = resp.json()["conversation_id"]

        db = SessionLocal()
        try:
            conv = db.query(Conversation).filter_by(id=old_conv_id).first()
            conv.status = ConversationStatus.RESOLVED
            conv.closed_by = "agent"
            db.commit()
        finally:
            db.close()

        # Create a new active conversation
        resp = client.post(
            f"/widget/conversations/new?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 201
        new_conv_id = resp.json()["conversation_id"]

        # Fetch conversations list
        resp = client.get(
            f"/widget/conversations?website_id={website_id}&session_id={session_id}",
            headers={"Origin": "http://site-a.test"},
        )
        assert resp.status_code == 200
        data = resp.json()

        # Active should be the new conversation
        assert data["active"] is not None
        assert data["active"]["id"] == new_conv_id

        # History should contain the old resolved conversation
        history_ids = [h["id"] for h in data["history"]]
        assert old_conv_id in history_ids


# ===================================================================
# 14. Inactive user cannot access API
# ===================================================================

class TestInactiveUser:

    def test_inactive_user_blocked(self, multi_org_env):
        from app.core.database import SessionLocal
        from app.models.user import User

        client = multi_org_env

        # Issue token while user is active
        headers = _auth(11)

        # Deactivate agent A
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=11).update({"is_active": False})
            db.commit()
        finally:
            db.close()

        resp = client.get("/websites", headers=headers)
        assert resp.status_code == 403
        assert "inactive" in resp.json()["detail"].lower()
