from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.core.database import get_db, SessionLocal
from app.models.user import User, UserRole
from app.models.system_settings import SystemSettings
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.core.limiter import limiter
from app.core.system import is_system_initialized, mark_system_initialized
from app.api.deps import get_current_user, require_admin

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()


class LoginRequest(BaseModel):
    email: str  # Changed from EmailStr to allow "Administrator" username
    password: str


class BootstrapRequest(BaseModel):
    """Request model for creating the first admin user"""
    name: str
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.AGENT


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    is_available: bool
    is_active: bool
    avatar_url: str | None = None

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.get("/setup/status")
async def check_setup_status():
    """
    Public endpoint to check if system needs initial setup.
    
    Returns:
        needs_setup: True if system is not initialized
    """
    return {
        "needs_setup": not is_system_initialized()
    }


@router.post("/bootstrap")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def bootstrap_admin(request: Request, bootstrap_request: BootstrapRequest):
    """
    Bootstrap endpoint - creates the first admin user.
    
    This endpoint:
    - Only works ONCE on a fresh installation
    - Creates Administrator user with SYSTEM_MANAGER role
    - Marks the system as initialized
    - Gets disabled forever after first use
    
    This prevents broken installs and ensures proper admin setup.
    """
    db = SessionLocal()
    
    try:
        # Check if system already initialized
        settings_row = db.query(SystemSettings).first()
        if settings_row and settings_row.is_initialized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System already initialized. Use /auth/login instead."
            )
        
        # Ensure no users exist (extra safety check)
        user_count = db.query(User).count()
        if user_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Users already exist. System may be corrupted."
            )
        
        # Create first admin user (Administrator)
        # Use fixed email if creating Administrator account
        admin_email = bootstrap_request.email
        admin_name = bootstrap_request.name or "Administrator"
        
        # If name is Administrator, use system email
        if admin_name == "Administrator":
            admin_email = "administrator@chatassist.system"
        
        admin = User(
            name=admin_name,
            email=admin_email,
            password_hash=get_password_hash(bootstrap_request.password),
            role=UserRole.SYSTEM_MANAGER,
            is_active=True,
            is_available=True
        )
        
        db.add(admin)
        
        # Mark system as initialized
        mark_system_initialized(db)
        
        db.commit()
        db.refresh(admin)
        
        return {
            "message": "Admin created successfully. System initialized.",
            "admin": {
                "id": admin.id,
                "name": admin.name,
                "email": admin.email,
                "role": admin.role.value
            }
        }
        
    finally:
        db.close()


@router.post("/login", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login(request: Request, login_request: LoginRequest, db: Session = Depends(get_db)):
    """
    User login endpoint with JWT authentication.
    Works for all user roles (SYSTEM_MANAGER, MANAGER, AGENT).
    Special case: 'Administrator' username maps to system admin email.
    """
    # Block login if system not initialized
    if not is_system_initialized():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System not initialized. Create admin first via /auth/bootstrap"
        )
    
    # Special case: Allow "Administrator" as username
    email = login_request.email
    if email.lower() == "administrator":
        email = "administrator@chatassist.system"
    
    # Find user by email
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    if not verify_password(login_request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # Generate JWT token with user_id and role
    access_token = create_access_token(
        data={
            "sub": "user",
            "user_id": user.id,
            "email": user.email,
            "role": user.role.value
        }
    )
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.from_orm(user)
    )


@router.post("/register")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def register(
    request: Request,
    register_request: RegisterRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)  # Only admins can create users
):
    """
    Register a new user account.
    Only accessible by admins (FULL_ACCESS).
    """
    # Check if user already exists
    existing_user = db.query(User).filter_by(email=register_request.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    user = User(
        name=register_request.name,
        email=register_request.email,
        password_hash=get_password_hash(register_request.password),
        role=register_request.role,
        is_active=True,
        is_available=True
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    return {
        "message": "User registered successfully",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value
        }
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user details."""
    return current_user


@router.get("/users")
async def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)  # Only admins can list users
):
    """
    List all users (for admin purposes).
    Only accessible by admins.
    """
    users = db.query(User).filter(User.is_active == True).all()
    return [
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
            "is_available": user.is_available,
            "is_active": user.is_active,
            "avatar_url": user.avatar_url,
        }
        for user in users
    ]
