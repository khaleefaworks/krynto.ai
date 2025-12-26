from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.website import Website
from app.api.auth import get_current_agent
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

router = APIRouter(prefix="/websites", tags=["websites"])


class WebsiteCreate(BaseModel):
    name: str
    domain: str
    ai_instructions: Optional[str] = None


class WebsiteUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    ai_instructions: Optional[str] = None


class WebsiteResponse(BaseModel):
    id: int
    name: str
    domain: str
    ai_instructions: Optional[str]
    widget_config: Optional[dict]
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class WidgetConfigResponse(BaseModel):
    theme: str = "dark"
    position: str = "bottom-right"
    welcome_message: str = "Hi! How can we help you today?"
    primary_color: str = "#000000"
    
    class Config:
        from_attributes = True


@router.get("", response_model=List[WebsiteResponse])
def list_websites(
    db: Session = Depends(get_db),
    current_agent = Depends(get_current_agent)
):
    """
    List all websites for the authenticated agent.
    """
    websites = db.query(Website).all()
    return websites


@router.post("", response_model=WebsiteResponse, status_code=201)
def create_website(
    website_data: WebsiteCreate,
    db: Session = Depends(get_db),
    current_agent = Depends(get_current_agent)
):
    """
    Create a new website.
    """
    # Check if domain already exists
    existing = db.query(Website).filter_by(domain=website_data.domain).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already registered")
    
    website = Website(
        name=website_data.name,
        domain=website_data.domain,
        ai_instructions=website_data.ai_instructions,
        widget_config={}  # Initialize with empty config
    )
    db.add(website)
    db.commit()
    db.refresh(website)
    return website


@router.get("/{website_id}", response_model=WebsiteResponse)
def get_website(
    website_id: int,
    db: Session = Depends(get_db),
    current_agent = Depends(get_current_agent)
):
    """
    Get a specific website by ID.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.put("/{website_id}", response_model=WebsiteResponse)
def update_website(
    website_id: int,
    website_data: WebsiteUpdate,
    db: Session = Depends(get_db),
    current_agent = Depends(get_current_agent)
):
    """
    Update a website.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    # Update only provided fields
    if website_data.name is not None:
        website.name = website_data.name
    if website_data.domain is not None:
        # Check if new domain conflicts with another website
        existing = db.query(Website).filter(
            Website.domain == website_data.domain,
            Website.id != website_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Domain already in use")
        website.domain = website_data.domain
    if website_data.ai_instructions is not None:
        website.ai_instructions = website_data.ai_instructions
    
    db.commit()
    db.refresh(website)
    return website


@router.delete("/{website_id}")
def delete_website(
    website_id: int,
    db: Session = Depends(get_db),
    current_agent = Depends(get_current_agent)
):
    """
    Delete a website.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    db.delete(website)
    db.commit()
    return {"success": True, "message": "Website deleted"}


@router.get("/{website_id}/widget-config")
def get_widget_config(website_id: int, db: Session = Depends(get_db)):
    """
    Get widget configuration for a website.
    Returns default config if not set.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    # Get widget config or use defaults
    config = website.widget_config or {}
    
    return {
        "theme": config.get("theme", "dark"),
        "position": config.get("position", "bottom-right"),
        "welcome_message": config.get("welcome_message", "Hi! How can we help you today?"),
        "primary_color": config.get("primary_color", "#000000"),
    }


@router.put("/{website_id}/widget-config")
def update_widget_config(
    website_id: int,
    config: dict,
    db: Session = Depends(get_db)
):
    """
    Update widget configuration for a website.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    website.widget_config = config
    db.commit()
    db.refresh(website)
    
    return {
        "success": True,
        "message": "Widget configuration updated",
        "config": website.widget_config
    }
