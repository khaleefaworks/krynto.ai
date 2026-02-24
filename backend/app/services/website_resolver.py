"""
Website Resolver - Determines website online/offline status.

This module provides the SINGLE SOURCE OF TRUTH for whether a website
is currently online and able to handle visitor chats.

CRITICAL: This must be used by:
- Widget (to show online/offline status)
- Chat routing (to determine if chat can be handled)
- Offline message flow (to know when to queue messages)
"""

from app.core.database import SessionLocal
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.website import Website
from app.models.user import User, UserRole
from app.repos import users as users_repo
from app.services.agent_resolver import is_agent_eligible
from app.services.agent_service import AgentService
from app.services.office_hours import is_within_office_hours


def is_website_online(website_id: int) -> bool:
    """
    Determine if a website is currently online.
    
    A website is online when AT LEAST ONE agent:
    1. Is assigned to the website
    2. Is active (account enabled)
    3. Is available (user toggled on)
    4. Is connected (has active WebSocket)
    
    Args:
        website_id: ID of the website to check
        
    Returns:
        True if website has at least one eligible agent, False otherwise
        
    Usage:
        # In widget status endpoint
        if is_website_online(website_id):
            return {"online": True}
        else:
            return {"online": False}
            
        # In chat routing
        if not is_website_online(website_id):
            handle_offline_message()
    """
    db = SessionLocal()
    
    try:
        website = db.query(Website).filter_by(id=int(website_id)).first()
        if not website:
            return False

        # Office hours gate: if enabled and currently outside schedule, force offline.
        if not is_within_office_hours(getattr(website, "widget_config", None) or {}):
            return False

        # Website online status is assignment-based.
        # If no agents are assigned, the website is offline.
        assignment_rows = (
            db.query(AgentWebsiteAssignment.agent_id)
            .filter(AgentWebsiteAssignment.website_id == int(website_id))
            .all()
        )
        assigned_agent_ids = sorted({int(r[0]) for r in assignment_rows})
        if not assigned_agent_ids:
            return False

        assigned_agents = (
            db.query(User)
            .filter(
                User.id.in_(assigned_agent_ids),
                User.is_active == True,  # noqa: E712
                User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER]),
            )
            .all()
        )
        
        # Use DB-backed heartbeat for presence so online/offline is consistent
        # across endpoints and supports multi-worker deployments.
        connected_user_ids = users_repo.recently_heartbeat_user_ids(
            db,
            ttl_seconds=AgentService.heartbeat_ttl_seconds,
        )
        
        # Check if any assigned agent is eligible
        for agent in assigned_agents:
            if is_agent_eligible(agent, agent.id in connected_user_ids):
                return True
        
        return False
        
    finally:
        db.close()
