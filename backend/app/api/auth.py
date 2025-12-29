from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.database import get_db
from app.models.user import User, UserRole
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.api.deps import get_current_user, require_admin

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()
limiter = Limiter(key_func=get_remote_address)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.LIMITED_ACCESS


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    is_available: bool
    is_active: bool

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post("/login", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login(request: Request, login_request: LoginRequest, db: Session = Depends(get_db)):
    """
    User login endpoint with JWT authentication.
    Works for both Admins (FULL_ACCESS) and Agents (LIMITED_ACCESS).
    """
    # Find user by email
    user = db.query(User).filter(User.email == login_request.email).first()
    
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
        }
        for user in users
    ]
