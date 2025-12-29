from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import require_authenticated_user
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
