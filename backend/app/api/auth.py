from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.database import get_db
from app.models.agent import Agent
from app.core.security import verify_password, get_password_hash, create_access_token, decode_access_token
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()
limiter = Limiter(key_func=get_remote_address)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class AgentResponse(BaseModel):
    id: int
    email: str
    is_active: bool

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    agent: AgentResponse


@router.post("/login", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login(request: Request, login_request: LoginRequest, db: Session = Depends(get_db)):
    """
    Agent login endpoint with JWT authentication.
    """
    # Find agent by email
    agent = db.query(Agent).filter(Agent.email == login_request.email).first()
    
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    if not verify_password(login_request.password, agent.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent account is inactive"
        )
    
    # Generate JWT token
    access_token = create_access_token(
        data={"sub": str(agent.id), "email": agent.email}
    )
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        agent=AgentResponse.from_orm(agent)
    )


@router.post("/register")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def register(request: Request, register_request: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new agent account."""
    # Check if agent already exists
    existing_agent = db.query(Agent).filter_by(email=register_request.email).first()
    if existing_agent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new agent
    agent = Agent(
        email=register_request.email,
        password_hash=get_password_hash(register_request.password),
        is_active=True
    )
    
    db.add(agent)
    db.commit()
    db.refresh(agent)
    
    return {
        "message": "Agent registered successfully",
        "agent": {
            "id": agent.id,
            "email": agent.email
        }
    }


def get_current_agent(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Agent:
    """Dependency to get current authenticated agent from JWT token."""
    token = credentials.credentials
    payload = decode_access_token(token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    agent_id = payload.get("sub")
    if agent_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    agent = db.query(Agent).filter_by(id=int(agent_id)).first()
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Agent not found"
        )
    
    return agent


@router.get("/me")
async def get_current_user(agent: Agent = Depends(get_current_agent)):
    """Get current authenticated agent details."""
    return {
        "id": agent.id,
        "email": agent.email,
        "is_active": agent.is_active
    }


@router.get("/agents")
async def list_agents(db: Session = Depends(get_db)):
    """List all agents (for admin purposes like website assignment)."""
    agents = db.query(Agent).filter(Agent.is_active == True).all()
    return [
        {
            "id": agent.id,
            "email": agent.email,
            "is_active": agent.is_active,
        }
        for agent in agents
    ]
