from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.api.deps import require_authenticated_user, require_admin
from app.models.user import User
from app.repos import tags as tag_repo

router = APIRouter(prefix="/websites/{website_id}/tags", tags=["tags"])

class TagBase(BaseModel):
    name: str
    color: str
    description: Optional[str] = None

class TagCreate(TagBase):
    pass

class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None

class TagResponse(TagBase):
    id: int
    website_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("", response_model=List[TagResponse])
def list_tags(
    website_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_authenticated_user),
):
    """List tags for a specific website."""
    return tag_repo.list_tags(db, website_id=website_id)

@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(
    website_id: int,
    tag_data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Create a new tag for a website (Admin only)."""
    return tag_repo.create_tag(
        db,
        name=tag_data.name,
        color=tag_data.color,
        website_id=website_id,
        description=tag_data.description
    )

@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(
    website_id: int,
    tag_id: int,
    tag_data: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Update a tag (Admin only)."""
    tag = tag_repo.get_tag(db, tag_id=tag_id)
    if not tag or tag.website_id != website_id:
        raise HTTPException(status_code=404, detail="Tag not found")
    updated = tag_repo.update_tag(
        db,
        tag_id=tag_id,
        name=tag_data.name,
        color=tag_data.color,
        description=tag_data.description
    )
    return updated

@router.delete("/{tag_id}")
def delete_tag(
    website_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Delete a tag (Admin only)."""
    tag = tag_repo.get_tag(db, tag_id=tag_id)
    if not tag or tag.website_id != website_id:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag_repo.delete_tag(db, tag_id)
    return {"message": "Tag deleted successfully"}
