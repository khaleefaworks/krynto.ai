from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.chat_service import ChatService
from app.core.logging import get_logger
import json
import traceback

router = APIRouter()
logger = get_logger(__name__)


@router.websocket("/ws/chat/{website_id}/{session_id}")
async def chat_ws(
    websocket: WebSocket,
    website_id: int,
    session_id: str,
):
    await websocket.accept()
    logger.info("visitor_websocket_connected", website_id=website_id, session_id=session_id)

    db = SessionLocal()
    
    try:
        chat_service = ChatService(db, website_id, session_id, websocket)
        logger.info("chat_service_initialized", conversation_id=chat_service.conversation.id, website_id=website_id, session_id=session_id)
    except Exception as e:
        logger.error("chat_service_init_error", website_id=website_id, session_id=session_id, error=str(e), exc_info=True)
        traceback.print_exc()
        db.close()
        await websocket.close(code=1011, reason=str(e))
        return

    try:
        while True:
            data = await websocket.receive_text()
            logger.debug("visitor_message_received", session_id=session_id, data=data)
            payload = json.loads(data)

            user_message = payload.get("message")
            if not user_message:
                continue

            logger.info("processing_visitor_message", session_id=session_id, message_length=len(user_message))
            response = await chat_service.handle_visitor_message(user_message)
            
            # Only send response if AI replied (not handed off to agent)
            if response:
                logger.info("ai_response_generated", session_id=session_id, response_length=len(response))
                await websocket.send_json({
                    "type": "ai",
                    "message": response
                })
                logger.debug("response_sent", session_id=session_id)
            else:
                logger.info("message_forwarded_to_agent", session_id=session_id)

    except WebSocketDisconnect:
        logger.info("visitor_websocket_disconnected", session_id=session_id)
        chat_service.close_session()
    except Exception as e:
        logger.error("websocket_handler_error", session_id=session_id, error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
    finally:
        db.close()
