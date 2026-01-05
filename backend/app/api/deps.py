from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError
from datetime import datetime

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.models.system_settings import SystemSettings


security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """
    Get current authenticated user from JWT token.
    Replaces get_current_agent.
    """
    token = credentials.credentials
    
    try:
        payload = decode_access_token(token)
        if payload is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
        
        # Check if token was issued before system reset
        token_iat = payload.get("iat")  # issued at timestamp
        if token_iat:
            system_settings = db.query(SystemSettings).first()
            if system_settings and system_settings.last_reset_at:
                token_datetime = datetime.fromtimestamp(token_iat)
                # Make both timezone-aware for comparison
                if token_datetime.tzinfo is None:
                    from datetime import timezone as tz
                    token_datetime = token_datetime.replace(tzinfo=tz.utc)
                if token_datetime < system_settings.last_reset_at:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Token invalidated due to system reset",
                    )
        
        user_id: int = int(payload.get("user_id"))
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )
    except (JWTError, ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    
    return user


def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Require admin privileges (SYSTEM_MANAGER or MANAGER role).
    Used for protected admin endpoints.
    Managers can access all admin features except reset application.
    """
    if not current_user.is_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def require_administrator(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Require administrator (SYSTEM_MANAGER only) role.
    Used for critical operations like reset application.
    """
    if not current_user.is_administrator():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )
    return current_user


def require_authenticated_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Require any authenticated user (admin or agent).
    Used for endpoints accessible to all logged-in users.
    """
    return current_user


def require_agent(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Require agent access (both FULL_ACCESS and LIMITED_ACCESS allowed).
    Used for agent dashboard and chat handling endpoints.
    
    Note: Admins (FULL_ACCESS) can also act as agents.
    """
    if current_user.role not in (UserRole.FULL_ACCESS, UserRole.LIMITED_ACCESS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent access required",
        )
    return current_user
