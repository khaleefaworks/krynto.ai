from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError
from datetime import datetime, timezone

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
                token_datetime = datetime.fromtimestamp(token_iat, tz=timezone.utc)
                reset_at = system_settings.last_reset_at
                if reset_at.tzinfo is None:
                    reset_at = reset_at.replace(tzinfo=timezone.utc)
                if token_datetime < reset_at:
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

    # Reject tokens issued before the user's last password change.
    if token_iat and user.password_changed_at:
        pwd_changed = user.password_changed_at
        if pwd_changed.tzinfo is None:
            pwd_changed = pwd_changed.replace(tzinfo=timezone.utc)
        token_datetime = datetime.fromtimestamp(token_iat, tz=timezone.utc)
        if token_datetime < pwd_changed:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token invalidated due to password change",
            )

    # Reject explicitly logged-out sessions (jti revocation).
    # Tokens without a jti claim were issued before this feature — skip the check
    # for backward compatibility; they still expire via the exp claim.
    token_jti = payload.get("jti")
    if token_jti:
        from app.repos import login_sessions as login_sessions_repo
        session_row = login_sessions_repo.get_by_jti(db, token_jti)
        if session_row is not None and not session_row.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked",
            )
        # Touch last_used_at asynchronously — best-effort, non-blocking.
        if session_row is not None and session_row.is_active:
            try:
                login_sessions_repo.touch_last_used(db, token_jti)
            except Exception:
                pass

    # Reject tokens for users whose organisation has been deactivated.
    if user.organization_id is not None:
        from app.models.organization import Organization
        org = db.query(Organization).filter(Organization.id == user.organization_id).first()
        if org and not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organisation is inactive",
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
    Require agent access.
    Used for agent dashboard and chat handling endpoints.

    Note: Admin roles (SYSTEM_MANAGER/OWNER/MANAGER) can also act as agents.
    """
    if current_user.role not in (UserRole.AGENT, UserRole.MANAGER, UserRole.OWNER, UserRole.SYSTEM_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent access required",
        )
    return current_user


def require_org_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """OWNER or MANAGER within an org. SYSTEM_MANAGER also passes."""
    if current_user.role not in (UserRole.OWNER, UserRole.MANAGER, UserRole.SYSTEM_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organisation admin access required",
        )
    return current_user


def require_org_owner(
    current_user: User = Depends(get_current_user),
) -> User:
    """Only the org OWNER (or SYSTEM_MANAGER) can do this."""
    if current_user.role not in (UserRole.OWNER, UserRole.SYSTEM_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organisation owner access required",
        )
    return current_user


def get_org_scope(current_user: User) -> int | None:
    """
    Returns organization_id for boundary filtering.
    None means unrestricted (SYSTEM_MANAGER / super-admin).
    """
    if current_user.is_superadmin():
        return None
    return current_user.organization_id
