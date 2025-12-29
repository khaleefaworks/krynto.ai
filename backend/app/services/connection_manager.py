"""
Connection Manager - Tracks active WebSocket connections.

This module maintains runtime state of which users are connected via WebSocket.
This is SEPARATE from database state (is_available).

Connection status is volatile and does not persist across restarts.
"""

from typing import Set

# In-memory storage of connected user IDs
# TODO: Move to Redis for multi-process/distributed deployment
_connected_users: Set[int] = set()


def mark_connected(user_id: int) -> None:
    """
    Mark a user as connected via WebSocket.
    
    Called when a user establishes a WebSocket connection.
    
    Args:
        user_id: ID of the connected user
    """
    _connected_users.add(user_id)


def mark_disconnected(user_id: int) -> None:
    """
    Mark a user as disconnected.
    
    Called when a user's WebSocket connection closes.
    
    Args:
        user_id: ID of the disconnected user
    """
    _connected_users.discard(user_id)


def get_connected_user_ids() -> Set[int]:
    """
    Get set of all currently connected user IDs.
    
    Returns:
        Set of user IDs with active WebSocket connections
    """
    return set(_connected_users)


def is_user_connected(user_id: int) -> bool:
    """
    Check if a specific user is currently connected.
    
    Args:
        user_id: ID of the user to check
        
    Returns:
        True if user has active WebSocket connection, False otherwise
    """
    return user_id in _connected_users


def get_connection_count() -> int:
    """
    Get total number of active connections.
    
    Returns:
        Number of users currently connected
    """
    return len(_connected_users)
