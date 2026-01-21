from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.services.presence_service import PresenceService
from app.core.config import settings
from app.core.widget_origin import get_widget_request_host, is_host_allowed_for_website
from app.infra.metrics import ws_connect, ws_disconnect, ws_error, ws_message
import structlog
import uuid

router = APIRouter()
logger = get_logger(__name__)


def _compute_presence(db: Session, website_id: int) -> dict:
    return PresenceService.compute_presence(db, website_id)


@router.websocket("/ws/presence/{website_id}")
async def presence_ws(websocket: WebSocket, website_id: int):
    """Public presence socket for the visitor widget.

    Client sends periodic pings; server replies with current presence snapshot.
    """
    connection_id = str(uuid.uuid4())
    incoming = (websocket.headers.get("x-request-id") or "").strip()
    request_id = incoming[:200] if incoming else connection_id

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        connection_id=connection_id,
        ws_kind="presence",
        website_id=website_id,
    )

    await websocket.accept()
    try:
        ws_connect(kind="presence")
    except Exception:
        pass
    logger.info("presence_ws_connected", website_id=website_id)

    db = SessionLocal()
    try:
        await PresenceService.register(website_id, websocket)

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
            try:
                ws_message(kind="presence", direction="in", message_type="text")
            except Exception:
                pass
            await websocket.send_json(_compute_presence(db, website_id))

    except WebSocketDisconnect:
        logger.info("presence_ws_disconnected", website_id=website_id)
    except Exception as e:
        try:
            ws_error(kind="presence", where="handler")
        except Exception:
            pass
        logger.error("presence_ws_error", website_id=website_id, error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        try:
            await PresenceService.unregister(website_id, websocket)
        except Exception:
            pass
        try:
            ws_disconnect(kind="presence")
        except Exception:
            pass
        db.close()

        try:
            structlog.contextvars.clear_contextvars()
        except Exception:
            pass
