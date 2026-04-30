from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.automation import Automation


def list_automations(db: Session, *, website_id: int) -> List[Automation]:
    return (
        db.query(Automation)
        .filter(Automation.website_id == website_id)
        .order_by(Automation.id.asc())
        .all()
    )


def get_automation(db: Session, *, automation_id: int, website_id: int | None = None) -> Optional[Automation]:
    query = db.query(Automation).filter(Automation.id == automation_id)
    if website_id is not None:
        query = query.filter(Automation.website_id == website_id)
    return query.first()


def create_automation(
    db: Session,
    *,
    website_id: int,
    name: str,
    trigger: str,
    enabled: bool = True,
    category: str = 'auto_message',
    nodes: list | None = None,
    edges: list | None = None,
) -> Automation:
    automation = Automation(
        website_id=website_id,
        name=name,
        trigger=trigger,
        enabled=bool(enabled),
        category=str(category or 'auto_message'),
        nodes=nodes or [],
        edges=edges or [],
    )
    db.add(automation)
    db.commit()
    db.refresh(automation)
    return automation


def update_automation(
    db: Session,
    *,
    automation: Automation,
    name: str | None = None,
    trigger: str | None = None,
    enabled: bool | None = None,
    category: str | None = None,
    nodes: list | None = None,
    edges: list | None = None,
) -> Automation:
    if name is not None:
        automation.name = name
    if trigger is not None:
        automation.trigger = trigger
    if enabled is not None:
        automation.enabled = bool(enabled)
    if category is not None:
        automation.category = str(category)
    if nodes is not None:
        automation.nodes = nodes
    if edges is not None:
        automation.edges = edges

    db.commit()
    db.refresh(automation)
    return automation


def delete_automation(db: Session, *, automation: Automation) -> None:
    db.delete(automation)
    db.commit()
