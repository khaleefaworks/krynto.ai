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
    conditions: dict | None = None,
    actions: dict | list | None = None,
) -> Automation:
    automation = Automation(
        website_id=website_id,
        name=name,
        trigger=trigger,
        enabled=bool(enabled),
        conditions=conditions or {},
        actions=actions or {},
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
    conditions: dict | None = None,
    actions: dict | list | None = None,
) -> Automation:
    if name is not None:
        automation.name = name
    if trigger is not None:
        automation.trigger = trigger
    if enabled is not None:
        automation.enabled = bool(enabled)
    if conditions is not None:
        automation.conditions = conditions
    if actions is not None:
        automation.actions = actions

    db.commit()
    db.refresh(automation)
    return automation


def delete_automation(db: Session, *, automation: Automation) -> None:
    db.delete(automation)
    db.commit()
