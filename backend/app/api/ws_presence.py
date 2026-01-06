from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.user import User, UserRole
from app.services.agent_resolver import is_agent_eligible
from app.services.agent_service import AgentService

router = APIRouter()
logger = get_logger(__name__)


def _compute_presence(db: Session, website_id: int) -> dict:
    """Compute website presence.

    Current product decision: with agent-website assignment removed from UI, any
    eligible agent (active + available + connected) is treated as available for
    any website.
    """
    connected_user_ids = {u_id for u_id in AgentService.last_heartbeat.keys() if AgentService.is_recently_connected(u_id)}

    candidates = (
        db.query(User)
        .filter(
            User.is_active == True,  # noqa: E712
            User.role.in_([UserRole.AGENT, UserRole.MANAGER, UserRole.SYSTEM_MANAGER]),
        )
        .all()
    )

    online_agents = [
        {
            "id": u.id,
            "name": u.name or "Support",
            "avatar_url": u.avatar_url,
        }
        for u in candidates
        if is_agent_eligible(u, u.id in connected_user_ids)
    ]

    available_agents_count = len(online_agents)

    return {
        "type": "presence",
        "website_id": website_id,
        "online": available_agents_count > 0,
        "available_agents_count": available_agents_count,
        "agents": online_agents[:3],
    }


@router.websocket("/ws/presence/{website_id}")
async def presence_ws(websocket: WebSocket, website_id: int):
    """Public presence socket for the visitor widget.

    Client sends periodic pings; server replies with current presence snapshot.
    """
    await websocket.accept()
    logger.info("presence_ws_connected", website_id=website_id)

    db = SessionLocal()
    try:
        # Send initial snapshot immediately.
        await websocket.send_json(_compute_presence(db, website_id))

        while True:
            # We don't require a specific message format; any message triggers a refresh.
            await websocket.receive_text()
            await websocket.send_json(_compute_presence(db, website_id))

    except WebSocketDisconnect:
        logger.info("presence_ws_disconnected", website_id=website_id)
    except Exception as e:
        logger.error("presence_ws_error", website_id=website_id, error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        db.close()
