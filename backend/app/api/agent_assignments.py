from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.agent import Agent
from app.models.website import Website

router = APIRouter(prefix="/agent-assignments", tags=["Agent Assignments"])


@router.post("/assign")
def assign_agent_to_website(payload: dict, db: Session = Depends(get_db)):
    """
    Assign an agent to a website.
    
    Request body:
    {
        "agent_id": int,
        "website_id": int
    }
    """
    agent_id = payload["agent_id"]
    website_id = payload["website_id"]
    
    # Verify agent exists
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Verify website exists
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    # Check if assignment already exists
    existing = (
        db.query(AgentWebsiteAssignment)
        .filter(
            AgentWebsiteAssignment.agent_id == agent_id,
            AgentWebsiteAssignment.website_id == website_id
        )
        .first()
    )
    
    if existing:
        return {
            "success": True,
            "message": "Agent already assigned to this website",
            "assignment_id": existing.id,
        }
    
    # Create assignment
    assignment = AgentWebsiteAssignment(
        agent_id=agent_id,
        website_id=website_id
    )
    
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    
    return {
        "success": True,
        "message": f"Agent {agent.email} assigned to website {website.name}",
        "assignment_id": assignment.id,
    }


@router.delete("/unassign")
def unassign_agent_from_website(payload: dict, db: Session = Depends(get_db)):
    """
    Remove an agent's assignment from a website.
    
    Request body:
    {
        "agent_id": int,
        "website_id": int
    }
    """
    agent_id = payload["agent_id"]
    website_id = payload["website_id"]
    
    assignment = (
        db.query(AgentWebsiteAssignment)
        .filter(
            AgentWebsiteAssignment.agent_id == agent_id,
            AgentWebsiteAssignment.website_id == website_id
        )
        .first()
    )
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    db.delete(assignment)
    db.commit()
    
    return {
        "success": True,
        "message": "Agent unassigned from website",
    }


@router.get("/agent/{agent_id}/websites")
def get_agent_websites(agent_id: int, db: Session = Depends(get_db)):
    """
    Get all websites assigned to an agent.
    """
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    assignments = (
        db.query(AgentWebsiteAssignment)
        .filter(AgentWebsiteAssignment.agent_id == agent_id)
        .all()
    )
    
    if not assignments:
        return []
    
    website_ids = [a.website_id for a in assignments]
    websites = db.query(Website).filter(Website.id.in_(website_ids)).all()
    
    # Create assignment lookup
    assignment_map = {a.website_id: a for a in assignments}
    
    return [
        {
            "id": w.id,
            "name": w.name,
            "domain": w.domain,
            "assigned_at": assignment_map[w.id].created_at.isoformat() if w.id in assignment_map and assignment_map[w.id].created_at else None,
        }
        for w in websites
    ]


@router.get("/website/{website_id}/agents")
def get_website_agents(website_id: int, db: Session = Depends(get_db)):
    """
    Get all agents assigned to a website.
    """
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    assignments = (
        db.query(AgentWebsiteAssignment)
        .filter(AgentWebsiteAssignment.website_id == website_id)
        .all()
    )
    
    if not assignments:
        return []
    
    agent_ids = [a.agent_id for a in assignments]
    agents = db.query(Agent).filter(Agent.id.in_(agent_ids)).all()
    
    # Create assignment lookup
    assignment_map = {a.agent_id: a for a in assignments}
    
    return [
        {
            "id": a.id,
            "email": a.email,
            "is_active": a.is_active,
            "assigned_at": assignment_map[a.id].created_at.isoformat() if a.id in assignment_map and assignment_map[a.id].created_at else None,
        }
        for a in agents
    ]


@router.get("/check")
def check_assignment(agent_id: int, website_id: int, db: Session = Depends(get_db)):
    """
    Check if an agent is assigned to a website.
    
    Query parameters:
    - agent_id: int
    - website_id: int
    """
    assignment = (
        db.query(AgentWebsiteAssignment)
        .filter(
            AgentWebsiteAssignment.agent_id == agent_id,
            AgentWebsiteAssignment.website_id == website_id
        )
        .first()
    )
    
    return {
        "is_assigned": assignment is not None,
        "assignment_id": assignment.id if assignment else None,
    }
