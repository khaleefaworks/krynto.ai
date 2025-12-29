from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole


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
        user_id: int = int(payload.get("user_id"))
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )
    except JWTError:
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
    Require admin privileges (FULL_ACCESS or MANAGER role).
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
    Require administrator (FULL_ACCESS only) role.
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
