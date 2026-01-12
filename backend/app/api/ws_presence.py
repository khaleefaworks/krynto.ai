from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.user import User, UserRole
from app.services.agent_resolver import is_agent_eligible
from app.services.agent_service import AgentService
from app.repos import users as users_repo
from app.core.config import settings
from app.core.widget_origin import get_widget_request_host, is_host_allowed_for_website
from app.infra.metrics import ws_connect, ws_disconnect

router = APIRouter()
logger = get_logger(__name__)


def _compute_presence(db: Session, website_id: int) -> dict:
    """Compute website presence.

    Current product decision: with agent-website assignment removed from UI, any
    eligible agent (active + available + recently active) is treated as available for
    any website.
    """
    # Presence is heartbeat-based so it can scale beyond a single worker.
    connected_user_ids = users_repo.recently_heartbeat_user_ids(
        db,
        ttl_seconds=AgentService.heartbeat_ttl_seconds,
    )

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
    try:
        ws_connect(kind="presence")
    except Exception:
        pass
    logger.info("presence_ws_connected", website_id=website_id)

    db = SessionLocal()
    try:
        # Validate website exists and enforce domain lock.
        from app.models.website import Website

        website = db.query(Website).filter_by(id=website_id).first()
        if not website:
            await websocket.close(code=1008, reason="Website not found")
            return

        request_host = get_widget_request_host(websocket.headers)
        if request_host and (not is_host_allowed_for_website(request_host=request_host, website_domain=website.domain)):
            logger.warning(
                "widget_origin_rejected",
                website_id=website_id,
                origin=str(websocket.headers.get("origin") or ""),
                referer=str(websocket.headers.get("referer") or ""),
                request_host=request_host,
                website_domain=str(website.domain or ""),
            )
            await websocket.close(code=1008, reason="Widget origin not allowed")
            return

        if (request_host is None) and settings.is_production():
            await websocket.close(code=1008, reason="Widget origin is required")
            return

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
        try:
            ws_disconnect(kind="presence")
        except Exception:
            pass
        db.close()
