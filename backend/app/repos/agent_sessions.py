from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.agent_session import AgentSession


def create_agent_session(
    db: Session,
    *,
    agent_id: int,
    website_id: int,
    websocket_id: str,
    is_online: bool = True,
) -> AgentSession:
    session = AgentSession(
        agent_id=agent_id,
        website_id=website_id,
        websocket_id=websocket_id,
        is_online=is_online,
    )
    db.add(session)
    db.commit()
    return session


def get_agent_session_by_websocket_id(db: Session, websocket_id: str) -> AgentSession | None:
    return db.query(AgentSession).filter_by(websocket_id=websocket_id).first()


def mark_agent_session_offline(db: Session, websocket_id: str) -> None:
    session = get_agent_session_by_websocket_id(db, websocket_id)
    if not session:
        return
    session.is_online = False
    db.commit()
