from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
import os
import uuid
import shutil
from pathlib import Path

from app.core.database import get_db
from app.core.uploads import get_uploads_root, uploads_url_to_path, validate_image_upload
from app.core.security import get_password_hash, verify_password
from app.api.deps import require_authenticated_user, require_admin, get_org_scope
from app.models.user import User, UserRole
from app.models.conversation import Conversation, ConversationStatus
from app.services.presence_service import PresenceService
from app.services.agent_service import AgentService
from app.services.agent_resolver import is_agent_eligible
from app.repos import users as users_repo


router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users (admin only). Scoped to the calling user's organization."""
    org_id = get_org_scope(_admin)
    q = db.query(User).filter(User.is_deleted == False)
    if org_id is not None:
        q = q.filter(User.organization_id == org_id)
    users = q.all()
    connected_ids = users_repo.recently_heartbeat_user_ids(
        db, ttl_seconds=AgentService.heartbeat_ttl_seconds,
    )
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role.value if hasattr(u.role, "value") else u.role,
            "is_available": bool(getattr(u, "is_available", False)),
            "is_active": bool(getattr(u, "is_active", False)),
            "is_connected": int(u.id) in connected_ids,
            "can_receive_chats": is_agent_eligible(u, int(u.id) in connected_ids),
            "avatar_url": getattr(u, "avatar_url", None),
            "is_locked_out": getattr(u, "is_locked_out", False),
            "failed_login_attempts": getattr(u, "failed_login_attempts", 0),
            "is_email_verified": bool(getattr(u, "is_email_verified", False)),
        }
        for u in users
    ]


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update user fields (admin only).

    Rules:
    - Email can be updated anytime (must remain unique)
    - Name can only be set once: allowed only if currently empty
    """

    user = db.query(User).filter(User.id == user_id, User.is_deleted == False).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Org boundary: non-superadmin admins can only update users in their own org.
    org_id = get_org_scope(_admin)
    if org_id is not None and user.organization_id != org_id:
        raise HTTPException(status_code=403, detail="User not found")

    changed = False

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        if not email:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email cannot be empty")

        existing = db.query(User).filter(User.email == email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        if user.email != email:
            user.email = email
            changed = True

    if payload.name is not None:
        name = str(payload.name).strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name cannot be empty")

        if user.name != name:
            user.name = name
            changed = True

    if changed:
        db.commit()
        db.refresh(user)

    return {
        "message": "User updated successfully",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value if hasattr(user.role, "value") else user.role,
            "is_active": user.is_active,
            "avatar_url": user.avatar_url,
        },
    }


class ToggleLockRequest(BaseModel):
    is_locked: bool


@router.post("/{user_id}/toggle-lock")
def toggle_user_lock(
    user_id: int,
    payload: ToggleLockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """Toggle the lock status of a user. Only OWNER can do this."""
    if current_user.role != UserRole.OWNER:
        raise HTTPException(status_code=403, detail="Only the organization owner can manage account locks.")

    user = db.query(User).filter(User.id == user_id, User.is_deleted == False).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Scope check
    org_id = get_org_scope(current_user)
    if org_id is not None and user.organization_id != org_id:
        raise HTTPException(status_code=403, detail="User not found in your organization")

    # Prevent locking oneself
    if user.id == current_user.id and payload.is_locked:
        raise HTTPException(status_code=400, detail="You cannot lock your own account")

    if payload.is_locked:
        user.is_locked_out = True
        user.failed_login_attempts = 6
    else:
        user.is_locked_out = False
        user.failed_login_attempts = 0
        user.temp_lockout_until = None

    db.commit()
    db.refresh(user)

    return {
        "message": "User lock status updated",
        "is_locked_out": user.is_locked_out
    }


class AvailabilityRequest(BaseModel):
    """Request to update user availability status"""
    is_available: bool


class AvailabilityResponse(BaseModel):
    """Response with current availability status"""
    is_available: bool


class AvatarUpdateRequest(BaseModel):
    """Request to update user avatar URL"""
    avatar_url: Optional[str] = None


class AvatarResponse(BaseModel):
    """Response with updated avatar URL"""
    avatar_url: Optional[str] = None


@router.post("/me/availability", response_model=AvailabilityResponse)
async def update_availability(
    payload: AvailabilityRequest,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Update current user's availability status.
    
    This is the ONLY way to change availability.
    Availability determines whether an agent can receive new chats.
    
    Rules:
    - Only the user can toggle their own availability
    - No admin override (intentionally simple for now)
    - No bulk updates
    - Persists across restarts
    
    Availability ≠ Connection Status:
    - is_available: User-controlled toggle (DB)
    - is_connected: WebSocket status (runtime)
    
    An agent must be BOTH available AND connected to receive chats.
    """
    current_user.is_available = payload.is_available
    db.commit()
    db.refresh(current_user)

    # Push presence updates to all connected visitor widgets.
    # Presence is website-scoped and assignment-based.
    # So a single agent toggling availability can affect any websites they're assigned to.
    try:
        await PresenceService.broadcast_all()
    except Exception:
        # Never fail the availability toggle because of a best-effort broadcast.
        pass

    # Notify all connected agent dashboards so Teams/Users pages can update in real-time.
    try:
        agent_svc = AgentService(db)
        await agent_svc.broadcast_to_active_agents(
            website_id=None,
            message_data={
                "type": "availability_changed",
                "agent_id": current_user.id,
                "is_available": current_user.is_available,
            },
            include_global=True,
        )
    except Exception:
        pass
    
    return AvailabilityResponse(is_available=current_user.is_available)


@router.get("/me/availability", response_model=AvailabilityResponse)
def get_availability(
    current_user: User = Depends(require_authenticated_user)
):
    """
    Get current user's availability status.
    """
    return AvailabilityResponse(is_available=current_user.is_available)


@router.post("/me/avatar/upload", response_model=AvatarResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Upload avatar image file.
    Saves file to disk and stores path in database.
    """
    file_extension = validate_image_upload(file)
    
    # Create uploads directory if it doesn't exist
    upload_dir = get_uploads_root() / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename
    unique_filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}.{file_extension}"
    file_path = upload_dir / unique_filename
    
    # Delete old avatar file if exists
    if current_user.avatar_url and current_user.avatar_url.startswith('/uploads/'):
        old_file = uploads_url_to_path(current_user.avatar_url)
        if old_file and old_file.exists():
            try:
                old_file.unlink()
            except Exception:
                pass
    
    # Save file
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Update database with relative URL
    current_user.avatar_url = f"/uploads/avatars/{unique_filename}"
    db.commit()
    db.refresh(current_user)
    
    return AvatarResponse(avatar_url=current_user.avatar_url)


@router.delete("/me/avatar", response_model=AvatarResponse)
def delete_avatar(
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Remove avatar image.
    """
    # Delete file if exists
    if current_user.avatar_url and current_user.avatar_url.startswith('/uploads/'):
        file_path = uploads_url_to_path(current_user.avatar_url)
        if file_path and file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
    
    current_user.avatar_url = None
    db.commit()
    db.refresh(current_user)
    
    return AvatarResponse(avatar_url=None)


@router.get("/me/avatar", response_model=AvatarResponse)
def get_avatar(
    current_user: User = Depends(require_authenticated_user)
):
    """
    Get current user's avatar URL.
    """
    return AvatarResponse(avatar_url=current_user.avatar_url)


@router.post("/{user_id}/avatar/upload", response_model=AvatarResponse)
async def upload_user_avatar(
    user_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)
):
    """Upload avatar image for any user (admin/manager only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    file_extension = validate_image_upload(file)

    upload_dir = get_uploads_root() / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_filename = f"{user.id}_{uuid.uuid4().hex[:8]}.{file_extension}"
    file_path = upload_dir / unique_filename

    if user.avatar_url and user.avatar_url.startswith('/uploads/'):
        old_file = uploads_url_to_path(user.avatar_url)
        if old_file and old_file.exists():
            try:
                old_file.unlink()
            except Exception:
                pass

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    user.avatar_url = f"/uploads/avatars/{unique_filename}"
    db.commit()
    db.refresh(user)
    return AvatarResponse(avatar_url=user.avatar_url)


@router.delete("/{user_id}/avatar", response_model=AvatarResponse)
def delete_user_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)
):
    """Remove avatar for any user (admin/manager only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.avatar_url and user.avatar_url.startswith('/uploads/'):
        file_path = uploads_url_to_path(user.avatar_url)
        if file_path and file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass

    user.avatar_url = None
    db.commit()
    db.refresh(user)
    return AvatarResponse(avatar_url=None)


class StatusUpdateRequest(BaseModel):
    """Request to update user active status (admin only)"""
    is_active: bool


@router.patch("/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: StatusUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)  # Only admins can update user status
):
    """
    Update a user's active status (enable/disable account).
    Only accessible by admins.
    
    Note: This is different from availability:
    - is_active: Account enabled/disabled (admin control)
    - is_available: Agent ready to take chats (user control)
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Administrator / system manager must always stay enabled.
    if user.role == UserRole.SYSTEM_MANAGER and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator account cannot be disabled",
        )

    # Owner account must not be disabled.
    if user.role == UserRole.OWNER and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner account cannot be disabled",
        )

    # Prevent users from disabling their own account.
    if user.id == _admin.id and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot disable your own account",
        )

    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    
    return {
        "message": "User status updated successfully",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_active": user.is_active,
        }
    }


class RoleUpdateRequest(BaseModel):
    """Request to update user role (admin only)"""
    role: UserRole


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin)  # Only admins can update user roles
):
    """
    Update a user's role.
    Only accessible by admins (Administrator or Manager).
    
    Rules:
    - Cannot change your own role
    - Cannot remove the last administrator
    - Managers cannot create administrators (only administrators can)
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Owner account role must not be changed.
    if user.role == UserRole.OWNER and payload.role != UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner account role cannot be changed",
        )

    # System Manager is a bootstrap-only Administrator account.
    # Do not allow changing its role (including demotion).
    if user.role == UserRole.SYSTEM_MANAGER and payload.role != UserRole.SYSTEM_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator account role cannot be changed",
        )

    # System Manager role is reserved for the one-time bootstrap administrator.
    # Do not allow promoting other accounts to SYSTEM_MANAGER.
    if payload.role == UserRole.SYSTEM_MANAGER and user.role != UserRole.SYSTEM_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System Manager role can only be created during initial bootstrap",
        )
    
    # Prevent changing your own role
    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role"
        )
    
    # Managers cannot create administrators or modify administrator roles
    if current_admin.role == UserRole.MANAGER:
        # Cannot change any user TO administrator
        if payload.role == UserRole.SYSTEM_MANAGER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can grant administrator role"
            )
        # Cannot modify existing administrators
        if user.role == UserRole.SYSTEM_MANAGER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can modify administrator accounts"
            )
        # Cannot grant OWNER role — only an OWNER or SYSTEM_MANAGER can do that
        if payload.role == UserRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Owners can grant Owner role",
            )
        # Cannot modify OWNER accounts at all
        if user.role == UserRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Owners can modify Owner accounts",
            )
    
    # Prevent removing the last administrator
    if user.role == UserRole.SYSTEM_MANAGER and payload.role != UserRole.SYSTEM_MANAGER:
        admin_count = db.query(User).filter(
            User.role == UserRole.SYSTEM_MANAGER,
            User.is_active == True
        ).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change role of the last administrator"
            )
    
    old_role = user.role.value
    user.role = payload.role
    db.commit()
    db.refresh(user)
    
    return {
        "message": f"User role updated from {old_role} to {payload.role.value}",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
        }
    }


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin)  # Only admins can delete users
):
    """
    Delete a user account.
    Only accessible by admins (Administrator or Manager).
    
    Rules:
    - Cannot delete yourself (the admin making the request)
    - Cannot delete the last administrator
    - Managers cannot delete administrators (only administrators can)
    - Soft delete by setting is_active to False
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent deleting yourself
    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    # Managers cannot delete administrators (SYSTEM_MANAGER)
    if current_admin.role == UserRole.MANAGER and user.role == UserRole.SYSTEM_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete administrator accounts"
        )

    # Administrator / system manager must always stay enabled.
    if user.role == UserRole.SYSTEM_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator account cannot be deleted",
        )

    # Owner deletion rules: allow deletion by SYSTEM_MANAGER or another OWNER in the same org,
    # but prevent deleting the last active owner for the organization.
    if user.role == UserRole.OWNER:
        # Only SYSTEM_MANAGER or an OWNER in the same org may delete an Owner
        if not (
            current_admin.role == UserRole.SYSTEM_MANAGER
            or (current_admin.role == UserRole.OWNER and current_admin.organization_id == user.organization_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Owners or administrators can delete Owner accounts",
            )

        # Prevent deleting the last active owner in the organisation
        org_id = user.organization_id
        owner_count = db.query(User).filter(
            User.organization_id == org_id,
            User.role == UserRole.OWNER,
            User.is_deleted == False,
        ).count()
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Their should be atleast 1 owner",
            )
    
    # Soft delete: mark as deleted and deactivate
    user.is_deleted = True
    user.is_active = False
    user.is_available = False

    # Unassign any open conversations still held by this agent so they
    # can be re-assigned without the deleted user blocking the queue.
    db.query(Conversation).filter(
        Conversation.assigned_agent_id == user_id,
        Conversation.status == ConversationStatus.OPEN,
    ).update({"assigned_agent_id": None}, synchronize_session=False)

    db.commit()
    
    return {
        "message": "User deleted successfully",
        "user_id": user_id
    }

@router.post("/{user_id}/undelete")
def undelete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin)
):
    """
    Restore a soft-deleted user (admin only).
    Sets `is_deleted` to False and re-enables the account (`is_active` = True).
    Scoped to the calling admin's organization (non-system admins).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Org boundary: non-superadmin admins can only act within their org.
    org_id = get_org_scope(current_admin)
    if org_id is not None and user.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not found")

    # Prevent modifying platform administrator via this endpoint.
    if user.role == UserRole.SYSTEM_MANAGER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Administrator account cannot be modified")

    # Managers cannot act on administrator accounts.
    if current_admin.role == UserRole.MANAGER and user.role == UserRole.SYSTEM_MANAGER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can modify administrator accounts")

    user.is_deleted = False
    user.is_active = True
    db.commit()
    db.refresh(user)

    return {
        "message": "User restored successfully",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value if hasattr(user.role, "value") else user.role,
            "is_active": user.is_active,
            "avatar_url": user.avatar_url,
        },
    }


class NotificationPreferences(BaseModel):
    new_chat_sound: str = 'new-notification.mp3'
    message_sound: str = 'notification.mp3'
    new_visitor_website_sound: str = ''


_ALLOWED_SOUNDS = {
    '', 'alarm.mp3', 'blackberry.mp3', 'blackberry2.mp3', 'echo.mp3',
    'message-bells.mp3', 'message.mp3', 'msn-message.mp3', 'msn-nudge.mp3',
    'new-notification.mp3', 'notification.mp3', 'simplesms.mp3', 'windows7.mp3',
}


@router.get("/me/notification-preferences", response_model=NotificationPreferences)
def get_notification_preferences(
    current_user: User = Depends(require_authenticated_user),
):
    prefs = current_user.notification_preferences or {}
    return NotificationPreferences(
        new_chat_sound=prefs.get('new_chat_sound', 'new-notification.mp3'),
        message_sound=prefs.get('message_sound', 'notification.mp3'),
        new_visitor_website_sound=prefs.get('new_visitor_website_sound', ''),
    )


@router.patch("/me/notification-preferences", response_model=NotificationPreferences)
def update_notification_preferences(
    payload: NotificationPreferences,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    for field in ('new_chat_sound', 'message_sound', 'new_visitor_website_sound'):
        val = getattr(payload, field)
        if val not in _ALLOWED_SOUNDS:
            raise HTTPException(status_code=400, detail=f"Invalid sound file: {val}")
    current_user.notification_preferences = {
        'new_chat_sound': payload.new_chat_sound,
        'message_sound': payload.message_sound,
        'new_visitor_website_sound': payload.new_visitor_website_sound,
    }
    db.add(current_user)
    db.commit()
    return NotificationPreferences(**current_user.notification_preferences)


class VerifyPasswordRequest(BaseModel):
    password: str


@router.post("/me/verify-password")
def verify_my_password(
    payload: VerifyPasswordRequest,
    current_user: User = Depends(require_authenticated_user),
):
    """
    Check whether the calling user's own password is correct.
    Always returns HTTP 200 with { valid: bool } — never a 4xx — so the
    client can give inline feedback without confusing error states.
    """
    valid = verify_password(payload.password, current_user.password_hash)
    return {"valid": valid}


class SelfPasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


@router.patch("/me/password")
def change_my_password(
    payload: SelfPasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    """
    Self-service password change — any authenticated user can change their own password.
    Requires the current password for re-verification.
    """
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    from datetime import datetime, timezone
    current_user.password_hash = get_password_hash(payload.new_password)
    current_user.password_changed_at = datetime.now(timezone.utc)
    db.add(current_user)
    db.commit()
    return {"message": "Password changed successfully"}


class PasswordChangeRequest(BaseModel):
    new_password: str = Field(..., min_length=6)


@router.patch("/{user_id}/password")
def change_user_password(
    user_id: int,
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """
    Set a new password for any user (owner/system_manager only).
    Managers must use /me/password to change their own password (requires current password).
    Owners and system managers can reset other users' passwords without re-auth.
    """
    # Only owner and system_manager can reset other users' passwords.
    if current_admin.role == UserRole.MANAGER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers cannot reset other users' passwords. Use your profile page to change your own password.",
        )

    # Prevent self-reset via this admin endpoint — use /me/password instead (requires current password).
    if current_admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Use /users/me/password to change your own password.",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    from datetime import datetime, timezone
    user.password_hash = get_password_hash(payload.new_password)
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Password updated successfully"}
