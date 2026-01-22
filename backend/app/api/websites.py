from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.website import Website
from app.core.widget_origin import enforce_widget_domain_or_403
from app.models.user import User
from app.api.deps import require_admin, require_authenticated_user
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid
import shutil
from pathlib import Path
from app.core.uploads import get_uploads_root, uploads_url_to_path, validate_image_upload

router = APIRouter(prefix="/websites", tags=["websites"])


class WebsiteCreate(BaseModel):
    name: str
    domain: str


class WebsiteUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    widget_config: Optional[dict] = None


class WebsiteResponse(BaseModel):
    id: int
    name: str
    domain: str
    widget_key: str
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
    header_title: str = "How can we help?"
    online_status_text: str = "We reply immediately"
    bubble_text: str = "Chat"
    show_emoji_picker: bool = True
    show_attachments: bool = False
    branding_text: Optional[str] = None
    header_icon_url: Optional[str] = None
    
    class Config:
        from_attributes = True


@router.get("", response_model=List[WebsiteResponse])
def list_websites(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user)
):
    """
    List all websites.
    Available to all authenticated users (admins and agents).
    """
    websites = db.query(Website).all()
    return websites


@router.post("", response_model=WebsiteResponse, status_code=201)
def create_website(
    website_data: WebsiteCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """
    Create a new website.
    Requires admin access (SYSTEM_MANAGER or MANAGER role).
    Widget key is automatically generated.
    """
    # Check if domain already exists
    existing = db.query(Website).filter_by(domain=website_data.domain).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already registered")
    
    website = Website(
        name=website_data.name,
        domain=website_data.domain,
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
    current_user: User = Depends(require_authenticated_user)
):
    """
    Get a specific website by ID.
    Available to all authenticated users.
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
    admin: User = Depends(require_admin)
):
    """
    Update a website.
    Requires admin access (SYSTEM_MANAGER or MANAGER role).
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
    if website_data.widget_config is not None:
        website.widget_config = website_data.widget_config
    
    db.commit()
    db.refresh(website)
    return website


@router.delete("/{website_id}")
def delete_website(
    website_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """
    Delete a website.
    Requires admin access (SYSTEM_MANAGER or MANAGER role).
    """
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    db.delete(website)
    db.commit()
    return {"success": True, "message": "Website deleted"}


@router.get("/{website_id}/widget-config")
def get_widget_config(request: Request, website_id: int, db: Session = Depends(get_db)):
    """
    Get widget configuration for a website (public endpoint for widget).
    Returns default config if not set.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    # This endpoint is consumed by the embedded widget from the visitor's site.
    # Enforce that Origin/Referer matches the website's configured domain.
    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    
    # Get widget config or use defaults
    config = website.widget_config or {}
    automations = config.get("automations") if isinstance(config.get("automations"), dict) else {}

    welcome_enabled = automations.get("welcome_enabled")
    if welcome_enabled is None:
        welcome_enabled = True

    welcome_message = automations.get("welcome_message") or config.get("welcome_message", "Hi! How can we help you today?")
    welcome_cooldown_hours = automations.get("welcome_cooldown_hours")
    try:
        welcome_cooldown_hours = int(welcome_cooldown_hours) if welcome_cooldown_hours is not None else 24
    except Exception:
        welcome_cooldown_hours = 24
    
    return {
        "theme": config.get("theme", "dark"),
        "position": config.get("position", "bottom-right"),
        # Legacy field (widget no longer auto-renders this text by default)
        "welcome_message": config.get("welcome_message", "Hi! How can we help you today?"),
        "primary_color": config.get("primary_color", "#000000"),
        "header_title": config.get("header_title", "How can we help?"),
        "online_status_text": config.get("online_status_text", "We reply immediately"),
        "bubble_text": config.get("bubble_text", "Chat"),
        "show_emoji_picker": config.get("show_emoji_picker", True),
        "show_attachments": config.get("show_attachments", False),
        "branding_text": config.get("branding_text"),
        "header_icon_url": config.get("header_icon_url"),
        "automations": {
            "welcome_enabled": bool(welcome_enabled),
            "welcome_message": str(welcome_message) if welcome_message is not None else "",
            "welcome_cooldown_hours": welcome_cooldown_hours,
        },
    }


@router.post("/{website_id}/widget-icon/upload")
async def upload_widget_icon(
    website_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)
):
    """Upload a website-specific widget header icon.

    Stores the uploaded image under uploads/websites/<website_id>/ and saves the
    public URL in website.widget_config['header_icon_url'].
    """
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    file_extension = validate_image_upload(file)

    upload_dir = get_uploads_root() / "websites" / str(website_id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_filename = f"widget_icon_{uuid.uuid4().hex[:10]}.{file_extension}"
    file_path = upload_dir / unique_filename

    # Delete old icon file if exists
    existing_config = website.widget_config or {}
    old_url = existing_config.get("header_icon_url")
    if old_url and isinstance(old_url, str) and old_url.startswith('/uploads/'):
        old_file = uploads_url_to_path(old_url)
        if old_file and old_file.exists():
            try:
                old_file.unlink()
            except Exception:
                pass

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    public_url = f"/uploads/websites/{website_id}/{unique_filename}"
    existing_config["header_icon_url"] = public_url
    website.widget_config = existing_config
    db.commit()
    db.refresh(website)

    return {"header_icon_url": public_url}


@router.put("/{website_id}/widget-config")
def update_widget_config(
    website_id: int,
    config: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """
    Update widget configuration for a website.
    Requires admin access (FULL_ACCESS role).
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


class AISettingsUpdate(BaseModel):
    ai_enabled: bool


class AISettingsResponse(BaseModel):
    ai_enabled: bool


@router.patch("/{website_id}/ai-settings", response_model=AISettingsResponse)
def update_ai_settings(
    website_id: int,
    settings: AISettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """
    Update AI settings for a website.
    Requires admin access (FULL_ACCESS role).
    
    Milestone 3: This endpoint exists but the ai_enabled flag
    is not yet used in chat routing logic. Data-only.
    """
    website = db.query(Website).filter_by(id=website_id).first()
    
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    website.ai_enabled = settings.ai_enabled
    db.commit()
    db.refresh(website)
    
    return AISettingsResponse(ai_enabled=website.ai_enabled)
