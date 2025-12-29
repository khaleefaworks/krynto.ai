"""
Agent Resolver - Central authority for agent eligibility.

This module defines the single source of truth for whether an agent
can receive new chats.

CRITICAL: All routing decisions MUST go through this logic.
"""

from app.models.user import User


def is_agent_eligible(user: User, is_connected: bool) -> bool:
    """
    Determine if an agent is eligible to receive new chats.
    
    An agent is eligible when ALL of these are true:
    1. Account is active (is_active = True)
    2. User has marked themselves available (is_available = True)
    3. User has an active WebSocket connection (is_connected = True)
    
    Args:
        user: User object (typically with LIMITED_ACCESS or FULL_ACCESS role)
        is_connected: Whether the user has an active WebSocket connection
        
    Returns:
        True if agent can receive new chats, False otherwise
        
    Usage:
        # In chat routing logic
        if is_agent_eligible(agent, websocket_active):
            assign_chat_to_agent(agent)
        else:
            handle_offline_flow()
    """
    return (
        user.is_active
        and user.is_available
        and is_connected
    )


def get_available_agents(users: list[User], connection_map: dict[int, bool]) -> list[User]:
    """
    Filter a list of users to only those eligible to receive chats.
    
    Args:
        users: List of User objects
        connection_map: Dict mapping user_id -> is_connected status
        
    Returns:
        List of eligible users
        
    Usage:
        agents = db.query(User).filter(User.role == UserRole.LIMITED_ACCESS).all()
        connections = {agent.id: agent.id in active_websockets}
        available = get_available_agents(agents, connections)
    """
    return [
        user for user in users
        if is_agent_eligible(user, connection_map.get(user.id, False))
    ]
