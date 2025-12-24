from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.agent import Agent

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class AgentResponse(BaseModel):
    id: int
    email: str
    is_active: bool

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    agent: AgentResponse


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    Agent login endpoint.
    
    For MVP, we do simple email-based authentication.
    In production, this would verify password hash.
    """
    # Find agent by email
    agent = db.query(Agent).filter(Agent.email == request.email).first()
    
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not agent.is_active:
        raise HTTPException(status_code=403, detail="Agent account is inactive")
    
    # TODO: In production, verify password hash here
    # For MVP, we accept any password for existing agents
    
    # Generate JWT token (mock for MVP)
    # In production, use proper JWT with secret key and expiration
    access_token = f"agent-token-{agent.id}"
    
    return LoginResponse(
        access_token=access_token,
        agent=AgentResponse.from_orm(agent)
    )
