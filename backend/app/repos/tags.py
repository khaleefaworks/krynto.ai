from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.tag import Tag
from app.models.conversation_tag import ConversationTag

def get_tag(db: Session, tag_id: int) -> Optional[Tag]:
    return db.query(Tag).filter(Tag.id == tag_id).first()

def list_tags(db: Session, website_id: int) -> List[Tag]:
    return db.query(Tag).filter(Tag.website_id == website_id).order_by(Tag.name.asc()).all()

def create_tag(db: Session, name: str, color: str, website_id: int, description: Optional[str] = None) -> Tag:
    db_tag = Tag(
        name=name,
        color=color,
        description=description,
        website_id=website_id,
    )
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag

def update_tag(db: Session, tag_id: int, name: Optional[str] = None, color: Optional[str] = None, description: Optional[str] = None) -> Optional[Tag]:
    db_tag = get_tag(db, tag_id)
    if not db_tag:
        return None
    
    if name is not None:
        db_tag.name = name
    if color is not None:
        db_tag.color = color
    if description is not None:
        db_tag.description = description
    
    db.commit()
    db.refresh(db_tag)
    return db_tag

def delete_tag(db: Session, tag_id: int) -> bool:
    db_tag = get_tag(db, tag_id)
    if not db_tag:
        return False
    
    db.delete(db_tag)
    db.commit()
    return True

def add_tag_to_conversation(db: Session, conversation_id: int, tag_id: int, created_by: Optional[int] = None) -> ConversationTag:
    # Check if already tagged
    existing = db.query(ConversationTag).filter_by(
        conversation_id=conversation_id,
        tag_id=tag_id
    ).first()
    if existing:
        return existing
        
    db_conv_tag = ConversationTag(
        conversation_id=conversation_id,
        tag_id=tag_id,
        created_by=created_by
    )
    db.add(db_conv_tag)
    db.commit()
    db.refresh(db_conv_tag)
    return db_conv_tag

def remove_tag_from_conversation(db: Session, conversation_id: int, tag_id: int) -> bool:
    db_conv_tag = db.query(ConversationTag).filter_by(
        conversation_id=conversation_id,
        tag_id=tag_id
    ).first()
    if not db_conv_tag:
        return False
    
    db.delete(db_conv_tag)
    db.commit()
    return True
