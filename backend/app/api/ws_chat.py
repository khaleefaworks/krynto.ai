from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.chat_service import ChatService
from app.core.logging import get_logger
from app.core.config import settings
import json
import time
import traceback
from collections import defaultdict

router = APIRouter()
logger = get_logger(__name__)

# Rate limiting for WebSocket messages
# Track message timestamps per session
message_timestamps = defaultdict(list)


@router.websocket("/ws/chat/{website_id}/{session_id}")
async def chat_ws(
    websocket: WebSocket,
    website_id: int,
    session_id: str,
):
    await websocket.accept()
    logger.info("visitor_websocket_connected", website_id=website_id, session_id=session_id)

    db = SessionLocal()

    orchestrator = ConversationOrchestrator(db)

    try:
        # Validate website exists before processing messages
        from app.models.website import Website
        website = db.query(Website).filter_by(id=website_id).first()
        if not website:
            error_msg = f"Website with ID {website_id} does not exist. Please create website first."
            logger.error("website_not_found", website_id=website_id, session_id=session_id)
            await websocket.send_json({
                "type": "error",
                "message": error_msg
            })
            await websocket.close(code=1008, reason=error_msg)
            db.close()
            return

        # Load history if a conversation already exists for this session.
        # IMPORTANT: Do NOT create a new conversation just because the widget connected.
        # We only create the conversation on the first visitor message.
        conversation = None
        try:
            from app.models.conversation import Conversation
            conversation = (
                db.query(Conversation)
                .filter_by(session_id=session_id, website_id=website_id)
                .first()
            )
        except Exception:
            conversation = None

        if conversation:
            ChatService.register_visitor(conversation.id, websocket)

            try:
                from app.models.message import Message

                messages = (
                    db.query(Message)
                    .filter_by(conversation_id=conversation.id)
                    .order_by(Message.created_at)
                    .all()
                )

                await websocket.send_json(
                    {
                        "type": "history",
                        "conversation_id": conversation.id,
                        "messages": [
                            {
                                "id": msg.id,
                                "sender": msg.sender,
                                "sender_type": msg.sender_type.value
                                if hasattr(msg.sender_type, "value")
                                else msg.sender_type,
                                "content": msg.content,
                                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                            }
                            for msg in messages
                        ],
                    }
                )
            except Exception as e:
                logger.error(
                    "failed_to_send_history",
                    website_id=website_id,
                    session_id=session_id,
                    error=str(e),
                    exc_info=True,
                )
        else:
            # Let the widget render an empty thread; conversation will be created on first message.
            await websocket.send_json({"type": "history", "conversation_id": None, "messages": []})
    except Exception as e:
        logger.error("chat_service_init_error", website_id=website_id, session_id=session_id, error=str(e), exc_info=True)
        db.close()
        error_msg = f"Failed to initialize chat: {str(e)}"
        await websocket.send_json({
            "type": "error",
            "message": error_msg
        })
        await websocket.close(code=1011, reason=error_msg)
        return

    try:
        while True:
            data = await websocket.receive_text()
            logger.debug("visitor_message_received", session_id=session_id, data=data)
            payload = json.loads(data)

            user_message = payload.get("message")
            if not user_message:
                continue

            visitor_name = payload.get("visitor_name")
            visitor_email = payload.get("visitor_email")
            
            # Rate limiting: Check message frequency
            current_time = time.time()
            session_messages = message_timestamps[session_id]
            
            # Remove timestamps older than 1 minute
            session_messages[:] = [ts for ts in session_messages if current_time - ts < 60]
            
            # Check if rate limit exceeded
            if len(session_messages) >= settings.RATE_LIMIT_CHAT_MESSAGE:
                logger.warning("rate_limit_exceeded", session_id=session_id, message_count=len(session_messages))
                await websocket.send_json({
                    "type": "error",
                    "message": "Rate limit exceeded. Please slow down."
                })
                continue
            
            # Add current timestamp
            session_messages.append(current_time)

            logger.info("processing_visitor_message", session_id=session_id, message_length=len(user_message))

            response = await orchestrator.handle_visitor_message(
                website_id=website_id,
                session_id=session_id,
                message=user_message,
                visitor_ws=websocket,
            )

            # Store visitor contact info if provided (conversation exists now after first message)
            if visitor_name or visitor_email:
                try:
                    from app.models.conversation import Conversation
                    conv = (
                        db.query(Conversation)
                        .filter_by(session_id=session_id, website_id=website_id)
                        .first()
                    )
                    if conv:
                        changed = False
                        if visitor_name and not conv.visitor_name:
                            conv.visitor_name = str(visitor_name)
                            changed = True
                        if visitor_email and not conv.visitor_email:
                            conv.visitor_email = str(visitor_email)
                            changed = True
                        if changed:
                            db.commit()
                except Exception:
                    # Don't fail chat delivery if metadata storage fails
                    pass

            # Orchestrator may return immediate text; keep backwards-compatible.
            if response:
                await websocket.send_json({"type": "system", "message": response})

    except WebSocketDisconnect:
        logger.info("visitor_websocket_disconnected", session_id=session_id)
        # Clean up visitor mapping and rate limit tracking
        try:
            from app.models.conversation import Conversation
            conv = db.query(Conversation).filter_by(session_id=session_id, website_id=website_id).first()
            if conv:
                ChatService.unregister_visitor(conv.id)
        except Exception:
            pass

        if session_id in message_timestamps:
            del message_timestamps[session_id]
    except Exception as e:
        logger.error("websocket_handler_error", session_id=session_id, error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
    finally:
        db.close()
