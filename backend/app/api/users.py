from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import require_authenticated_user, require_admin
from app.models.user import User


router = APIRouter(prefix="/users", tags=["users"])


class AvailabilityRequest(BaseModel):
    """Request to update user availability status"""
    is_available: bool


class AvailabilityResponse(BaseModel):
    """Response with current availability status"""
    is_available: bool


@router.post("/me/availability", response_model=AvailabilityResponse)
def update_availability(
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
    
    return AvailabilityResponse(is_available=current_user.is_available)


@router.get("/me/availability", response_model=AvailabilityResponse)
def get_availability(
    current_user: User = Depends(require_authenticated_user)
):
    """
    Get current user's availability status.
    """
    return AvailabilityResponse(is_available=current_user.is_available)


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


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin)  # Only admins can delete users
):
    """
    Delete a user account.
    Only accessible by admins.
    
    Rules:
    - Cannot delete yourself (the admin making the request)
    - Cannot delete the last admin user
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
    
    # Prevent deleting the last admin
    if user.role.value == "full_access":
        admin_count = db.query(User).filter(
            User.role == user.role,
            User.is_active == True
        ).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the last administrator account"
            )
    
    # Soft delete
    user.is_active = False
    db.commit()
    
    return {
        "message": "User deleted successfully",
        "user_id": user_id
    }
