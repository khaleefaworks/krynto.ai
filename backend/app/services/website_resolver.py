"""
Website Resolver - Determines website online/offline status.

This module provides the SINGLE SOURCE OF TRUTH for whether a website
is currently online and able to handle visitor chats.

CRITICAL: This must be used by:
- Widget (to show online/offline status)
- Chat routing (to determine if chat can be handled)
- Offline message flow (to know when to queue messages)
"""

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.user import User
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.services.agent_resolver import is_agent_eligible


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
        # Get all users assigned to this website
        assigned_agents = (
            db.query(User)
            .join(AgentWebsiteAssignment, User.id == AgentWebsiteAssignment.agent_id)
            .filter(
                AgentWebsiteAssignment.website_id == website_id,
                User.is_active == True  # Only consider active users
            )
            .all()
        )
        
        # Get set of currently connected user IDs from active WebSocket connections
        from app.services.agent_service import AgentService
        connected_user_ids = {info["agent_id"] for info in AgentService.active_agents.values()}
        
        # Check if any assigned agent is eligible
        for agent in assigned_agents:
            if is_agent_eligible(agent, agent.id in connected_user_ids):
                return True
        
        return False
        
    finally:
        db.close()


def get_online_websites() -> list[int]:
    """
    Get list of all website IDs that are currently online.
    
    Returns:
        List of website IDs with at least one eligible agent
        
    Note: This can be expensive. Use sparingly or cache results.
    """
    db = SessionLocal()
    
    try:
        # Get all unique website IDs from assignments
        from app.models.website import Website
        websites = db.query(Website.id).all()
        
        online_websites = []
        for (website_id,) in websites:
            if is_website_online(website_id):
                online_websites.append(website_id)
        
        return online_websites
        
    finally:
        db.close()


def get_eligible_agents_for_website(website_id: int, db: Session = None) -> list[User]:
    """
    Get all currently eligible agents for a website.
    
    Args:
        website_id: ID of the website
        db: Database session (optional, creates new if not provided)
        
    Returns:
        List of User objects that are eligible to handle chats
        
    Usage:
        eligible = get_eligible_agents_for_website(website_id)
        if eligible:
            agent = random.choice(eligible)  # Simple round-robin
            assign_chat_to_agent(chat, agent)
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        # Get all users assigned to this website
        assigned_agents = (
            db.query(User)
            .join(AgentWebsiteAssignment, User.id == AgentWebsiteAssignment.agent_id)
            .filter(
                AgentWebsiteAssignment.website_id == website_id,
                User.is_active == True
            )
            .all()
        )
        
        # Get set of currently connected user IDs from active WebSocket connections
        from app.services.agent_service import AgentService
        connected_user_ids = {info["agent_id"] for info in AgentService.active_agents.values()}
        
        # Filter to only eligible agents
        eligible_agents = [
            agent for agent in assigned_agents
            if is_agent_eligible(agent, agent.id in connected_user_ids)
        ]
        
        return eligible_agents
        
    finally:
        if close_db:
            db.close()
