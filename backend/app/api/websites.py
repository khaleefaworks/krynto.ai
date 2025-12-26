from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.website import Website
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/websites", tags=["websites"])


class WidgetConfigResponse(BaseModel):
    theme: str = "dark"
    position: str = "bottom-right"
    welcome_message: str = "Hi! How can we help you today?"
    primary_color: str = "#000000"
    
    class Config:
        from_attributes = True


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
