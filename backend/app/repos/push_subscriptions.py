from sqlalchemy.orm import Session

from app.models.push_subscription import PushSubscription


def upsert_subscription(
    db: Session,
    *,
    agent_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None = None,
) -> PushSubscription:
    existing = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.agent_id == int(agent_id),
            PushSubscription.endpoint == str(endpoint),
        )
        .first()
    )

    if existing:
        existing.p256dh = str(p256dh)
        existing.auth = str(auth)
        existing.user_agent = str(user_agent) if user_agent else None
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    sub = PushSubscription(
        agent_id=int(agent_id),
        endpoint=str(endpoint),
        p256dh=str(p256dh),
        auth=str(auth),
        user_agent=str(user_agent) if user_agent else None,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def delete_subscription(db: Session, *, agent_id: int, endpoint: str) -> int:
    q = db.query(PushSubscription).filter(
        PushSubscription.agent_id == int(agent_id),
        PushSubscription.endpoint == str(endpoint),
    )
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return int(deleted or 0)


def list_subscriptions_for_agent(db: Session, *, agent_id: int) -> list[PushSubscription]:
    return (
        db.query(PushSubscription)
        .filter(PushSubscription.agent_id == int(agent_id))
        .all()
    )


def list_subscriptions_for_agents(db: Session, *, agent_ids: set[int]) -> list[PushSubscription]:
    if not agent_ids:
        return []
    return db.query(PushSubscription).filter(PushSubscription.agent_id.in_([int(x) for x in agent_ids])).all()
