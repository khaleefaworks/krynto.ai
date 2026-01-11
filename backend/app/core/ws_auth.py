"""
WebSocket Authentication Utilities

Provides helper functions for validating JWT tokens in WebSocket connections.
Supports authentication via:
1. Query parameter: ?token=<jwt>
2. Initial message: {"type": "auth", "token": "<jwt>"}
"""

from typing import Optional, Tuple
from fastapi import WebSocket, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import json

from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.models.system_settings import SystemSettings
from app.core.logging import get_logger

logger = get_logger(__name__)


async def authenticate_websocket(
    websocket: WebSocket,
    db: Session,
    token: Optional[str] = None,
    required_roles: Optional[list[UserRole]] = None
) -> Optional[User]:
    """
    Authenticate WebSocket connection with JWT token.
    
    Args:
        websocket: The WebSocket connection
        db: Database session
        token: JWT token (from query param or will wait for auth message)
        required_roles: List of roles user must have (None = any authenticated user)
        
    Returns:
        User object if authenticated, None if authentication failed
        
    Note:
        If authentication fails, sends error message and closes connection
    """
    
    # If no token provided, wait for auth message
    if not token:
        try:
            # Wait for initial auth message (timeout 5 seconds)
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if payload.get("type") != "auth":
                await send_error_and_close(
                    websocket,
                    "First message must be authentication",
                    status.WS_1008_POLICY_VIOLATION
                )
                return None
                
            token = payload.get("token")
            if not token:
                await send_error_and_close(
                    websocket,
                    "Missing token in auth message",
                    status.WS_1008_POLICY_VIOLATION
                )
                return None
                
        except json.JSONDecodeError:
            await send_error_and_close(
                websocket,
                "Invalid JSON in auth message",
                status.WS_1003_UNSUPPORTED_DATA
            )
            return None
        except Exception as e:
            logger.error("websocket_auth_error", error=str(e))
            await send_error_and_close(
                websocket,
                "Authentication failed",
                status.WS_1011_INTERNAL_ERROR
            )
            return None
    
    # Validate token
    payload = decode_access_token(token)
    if not payload:
        await send_error_and_close(
            websocket,
            "Invalid or expired token",
            status.WS_1008_POLICY_VIOLATION
        )
        return None
    
    # Check if token was issued before system reset
    token_iat = payload.get("iat")
    if token_iat:
        system_settings = db.query(SystemSettings).first()
        if system_settings:
            reset_at = system_settings.last_reset_at
            if reset_at is not None:
                # Ensure both sides are timezone-aware UTC to avoid TypeError
                # (can happen depending on DB/driver behavior).
                token_datetime = datetime.fromtimestamp(token_iat, tz=timezone.utc)
                if reset_at.tzinfo is None:
                    reset_at = reset_at.replace(tzinfo=timezone.utc)
                if token_datetime < reset_at:
                    await send_error_and_close(
                        websocket,
                        "Token invalidated due to system reset",
                        status.WS_1008_POLICY_VIOLATION
                    )
                    return None
    
    # Get user from token
    user_id = payload.get("user_id")
    if not user_id:
        await send_error_and_close(
            websocket,
            "Invalid token payload",
            status.WS_1008_POLICY_VIOLATION
        )
        return None
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        await send_error_and_close(
            websocket,
            "User not found",
            status.WS_1008_POLICY_VIOLATION
        )
        return None
    
    # Check if user is active (convert Column to bool)
    is_active = bool(user.is_active)
    if not is_active:
        await send_error_and_close(
            websocket,
            "User account is inactive",
            status.WS_1008_POLICY_VIOLATION
        )
        return None
    
    # Check role requirements
    if required_roles and user.role not in required_roles:
        await send_error_and_close(
            websocket,
            f"Insufficient permissions. Required roles: {[r.value for r in required_roles]}",
            status.WS_1008_POLICY_VIOLATION
        )
        return None
    
    logger.info("websocket_authenticated", user_id=user.id, email=user.email, role=user.role.value)
    return user


async def send_error_and_close(
    websocket: WebSocket,
    error_message: str,
    close_code: int = status.WS_1008_POLICY_VIOLATION
):
    """
    Send error message and close WebSocket connection.
    
    Args:
        websocket: The WebSocket connection
        error_message: Error message to send
        close_code: WebSocket close code (default: 1008 Policy Violation)
    """
    try:
        await websocket.send_json({
            "type": "error",
            "message": error_message
        })
    except:
        pass  # Ignore send errors
    
    try:
        await websocket.close(code=close_code, reason=error_message)
    except:
        pass  # Ignore close errors
    
    logger.warning("websocket_auth_failed", error=error_message, code=close_code)


def extract_token_from_query(websocket: WebSocket) -> Optional[str]:
    """
    Extract JWT token from WebSocket query parameters.
    
    Args:
        websocket: The WebSocket connection
        
    Returns:
        Token string if found, None otherwise
    """
    return websocket.query_params.get("token")
