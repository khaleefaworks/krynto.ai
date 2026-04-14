from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.chat_service import ChatService
from app.core.logging import get_logger
from app.core.ws_auth import authenticate_websocket, extract_token_from_query
from app.models.user import UserRole
from app.models.user import User
import json
import asyncio

from app.core.message_presenter import serialize_message
from app.repos import messages as messages_repo
from app.repos import users as users_repo
from app.repos import conversations as conversations_repo
from app.services.visibility import compute_visibility_scope
from datetime import datetime
from app.infra.metrics import ws_connect, ws_disconnect, ws_error, ws_message
import structlog
import uuid

router = APIRouter()
logger = get_logger(__name__)
@router.websocket("/ws/agent/{website_id}")
async def agent_ws(
    websocket: WebSocket,
    website_id: int,
):
    connection_id = str(uuid.uuid4())
    incoming = (websocket.headers.get("x-request-id") or "").strip()
    request_id = incoming[:200] if incoming else connection_id

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        connection_id=connection_id,
        ws_kind="agent",
        website_id=website_id,
    )

    await websocket.accept()
    try:
        ws_connect(kind="agent")
    except Exception:
        pass
    logger.info("agent_websocket_connection_attempt", website_id=website_id)

    db = SessionLocal()
    agent_id = None
    websocket_id = None
    agent_service = None
    last_db_heartbeat_at: datetime | None = None
    server_heartbeat_interval_seconds: float = 25.0
    
    try:
        # Authenticate WebSocket connection - agent_id comes from JWT token
        token = extract_token_from_query(websocket)
        user = await authenticate_websocket(
            websocket, 
            db, 
            token=token,
            required_roles=[UserRole.AGENT, UserRole.SYSTEM_MANAGER, UserRole.MANAGER, UserRole.OWNER]
        )
        
        if not user:
            # authenticate_websocket already sent error and closed connection
            db.close()
            return
        
        # Use agent_id from authenticated token, not URL
        agent_id = user.id
        structlog.contextvars.bind_contextvars(agent_id=agent_id)
        logger.info("agent_websocket_authenticated", agent_id=agent_id, website_id=website_id, email=user.email)
        
        requested_website_id = website_id

        # Production model: a single global agent socket (website_id=0).
        # Keep the route param for backwards compatibility, but normalize internally
        # to avoid duplicated connections and delivery ambiguity.
        if requested_website_id != 0:
            logger.info(
                "agent_ws_website_id_normalized_to_global",
                agent_id=agent_id,
                requested_website_id=requested_website_id,
            )
            website_id = 0

        agent_service = AgentService(db)
        orchestrator = ConversationOrchestrator(db)
        
        # Register agent connection
        websocket_id = agent_service.register_agent(agent_id, website_id, websocket)
        logger.info("agent_registered", agent_id=agent_id, websocket_id=websocket_id, website_id=website_id)

        # Ensure DB heartbeat is set on connect (in addition to in-memory heartbeat).
        try:
            now = datetime.utcnow()
            users_repo.touch_last_heartbeat_at(db, user_id=agent_id, now=now)
            db.commit()
            last_db_heartbeat_at = now
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        
        # Send confirmation
        await websocket.send_json({
            "type": "connected",
            "agent_id": agent_id,
            # Backwards-compatible: reflect requested website_id even though the
            # server treats agent sockets as global for delivery.
            "website_id": requested_website_id,
            "message": "Agent connected successfully"
        })
        
        # Listen for agent messages.
        # Important: keep DB-backed presence alive even if the agent tab is idle.
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(), timeout=server_heartbeat_interval_seconds
                )
            except asyncio.TimeoutError:
                # No inbound messages recently, but the socket is still connected.
                # Treat that as "online" for presence and update heartbeat.
                try:
                    AgentService.mark_heartbeat(agent_id)
                except Exception:
                    pass

                try:
                    now = datetime.utcnow()
                    if (last_db_heartbeat_at is None) or (
                        (now - last_db_heartbeat_at).total_seconds() >= 10
                    ):
                        users_repo.touch_last_heartbeat_at(db, user_id=agent_id, now=now)
                        db.commit()
                        last_db_heartbeat_at = now
                except Exception:
                    try:
                        db.rollback()
                    except Exception:
                        pass

                continue
            try:
                ws_message(kind="agent", direction="in", message_type="text")
            except Exception:
                pass
            logger.debug("agent_message_received", agent_id=agent_id, data=data)
            payload = json.loads(data)

            # The agent WebSocket uses a long-lived DB session. Other HTTP requests
            # (e.g. /chats/{id}/join) may update rows in separate sessions.
            # Expire the identity map so we don't make decisions on stale ORM state
            # (e.g. assigned_agent_id still None right after join).
            try:
                db.expire_all()
            except Exception:
                pass

            # Any inbound message counts as activity for presence.
            try:
                AgentService.mark_heartbeat(agent_id)
            except Exception:
                pass

            # Persist heartbeat occasionally (avoid committing every message).
            try:
                now = datetime.utcnow()
                if (last_db_heartbeat_at is None) or ((now - last_db_heartbeat_at).total_seconds() >= 10):
                    users_repo.touch_last_heartbeat_at(db, user_id=agent_id, now=now)
                    db.commit()
                    last_db_heartbeat_at = now
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
            
            message_type = payload.get("type")

            try:
                ws_message(kind="agent", direction="in", message_type=str(message_type or "unknown"))
            except Exception:
                pass

            if message_type == "heartbeat":
                # No-op response; presence socket polls separately.
                continue

            if message_type == "typing":
                conversation_id_raw = payload.get("conversation_id")
                try:
                    conversation_id = int(conversation_id_raw)
                except Exception:
                    await websocket.send_json({"type": "error", "message": "Invalid conversation_id"})
                    continue

                is_typing = bool(payload.get("is_typing"))

                conv = conversations_repo.get_conversation_by_id(db, conversation_id)
                if not conv:
                    await websocket.send_json({"type": "error", "message": "Conversation not found"})
                    continue

                scope = compute_visibility_scope(db, user=user)
                if scope.website_ids is not None and int(conv.website_id) not in set(scope.website_ids):
                    await websocket.send_json({"type": "error", "message": "Chat not available"})
                    continue
                if scope.team_ids is not None:
                    tid = getattr(conv, "team_id", None)
                    if tid is None or int(tid) not in set(scope.team_ids):
                        await websocket.send_json({"type": "error", "message": "Chat not available"})
                        continue

                # Only forward typing to the visitor if this agent is assigned
                # (or the conversation is unassigned and they may pick it up).
                # Spectating agents' typing must never appear in the visitor widget.
                is_assigned_agent = (
                    conv.assigned_agent_id is None
                    or conv.assigned_agent_id == agent_id
                )
                if is_assigned_agent:
                    await ChatService.send_to_visitor(
                        conversation_id,
                        {
                            "type": "agent_typing",
                            "conversation_id": conversation_id,
                            "is_typing": is_typing,
                            "agent_id": agent_id,
                            "agent_name": user.name,
                            "agent_avatar": user.avatar_url,
                        },
                    )

                # Always broadcast to other agents so spectators see who is typing.
                await agent_service.broadcast_to_active_agents(
                    website_id=int(conv.website_id),
                    message_data={
                        "type": "agent_typing",
                        "conversation_id": conversation_id,
                        "is_typing": is_typing,
                        "agent_id": agent_id,
                        "agent_name": user.name,
                    },
                    include_global=True,
                    exclude_agent_id=agent_id,
                )
                continue
            
            if message_type == "join_chat":
                conversation_id_raw = payload.get("conversation_id")
                try:
                    conversation_id = int(conversation_id_raw)
                except Exception:
                    await websocket.send_json({"type": "error", "message": "Invalid conversation_id"})
                    continue
                logger.info("agent_joining_conversation", agent_id=agent_id, conversation_id=conversation_id)

                conv = conversations_repo.get_conversation_by_id(db, conversation_id)
                if not conv:
                    await websocket.send_json({"type": "error", "message": "Conversation not found"})
                    continue

                scope = compute_visibility_scope(db, user=user)
                if scope.website_ids is not None and int(conv.website_id) not in set(scope.website_ids):
                    await websocket.send_json({"type": "error", "message": "Chat not available"})
                    continue
                if scope.team_ids is not None:
                    tid = getattr(conv, "team_id", None)
                    if tid is None or int(tid) not in set(scope.team_ids):
                        await websocket.send_json({"type": "error", "message": "Chat not available"})
                        continue

                result = await orchestrator.handle_agent_join(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                )

                if result.get("error"):
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    continue

                messages = agent_service.get_conversation_messages(conversation_id)
                history = []
                for msg in messages:
                    history.append(serialize_message(db, msg))

                await websocket.send_json(
                    {
                        "type": "joined",
                        "conversation_id": conversation_id,
                        # Backwards-compatible: frontend expects `history`.
                        "history": history,
                        # Canonical alias to match visitor socket `history.messages` naming.
                        "messages": history,
                    }
                )

            elif message_type == "message":
                conversation_id_raw = payload.get("conversation_id")
                try:
                    conversation_id = int(conversation_id_raw)
                except Exception:
                    continue
                content = payload.get("content")
                message_id = payload.get("message_id")  # Extract message ID for acknowledgment

                if not content or not conversation_id:
                    continue

                conv = conversations_repo.get_conversation_by_id(db, conversation_id)
                if not conv:
                    await websocket.send_json({"type": "error", "message": "Conversation not found"})
                    continue

                scope = compute_visibility_scope(db, user=user)
                if scope.website_ids is not None and int(conv.website_id) not in set(scope.website_ids):
                    await websocket.send_json({"type": "error", "message": "Chat not available"})
                    continue
                if scope.team_ids is not None:
                    tid = getattr(conv, "team_id", None)
                    if tid is None or int(tid) not in set(scope.team_ids):
                        await websocket.send_json({"type": "error", "message": "Chat not available"})
                        continue

                logger.info("agent_sending_message", agent_id=agent_id, conversation_id=conversation_id, content_length=len(content), message_id=message_id)

                result = await orchestrator.handle_agent_message(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                    content=content,
                )

                if result.get("error"):
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    continue

                # ACK only after successful processing so the client won't drop
                # messages that failed validation/persistence.
                if message_id:
                    await websocket.send_json({
                        "type": "ack",
                        "message_id": message_id,
                    })

                message_obj = None
                try:
                    message_id_saved = result.get("message_id")
                    if message_id_saved:
                        saved_msg = messages_repo.get_message_by_id(db, int(message_id_saved))
                        if saved_msg:
                            message_obj = serialize_message(db, saved_msg)
                except Exception:
                    message_obj = None
                
                # Send confirmation back to agent
                await websocket.send_json({
                    "type": "message_sent",
                    "conversation_id": conversation_id,
                    "content": content,
                    "client_message_id": message_id,
                    "message_obj": message_obj,
                    "agent_is_available": result.get("agent_is_available"),
                    "availability_changed": result.get("availability_changed"),
                    "success": True
                })

    except WebSocketDisconnect:
        if agent_id:
            logger.info("agent_disconnected", agent_id=agent_id)
    except Exception as e:
        try:
            ws_error(kind="agent", where="handler")
        except Exception:
            pass
        if agent_id:
            logger.error("agent_websocket_error", agent_id=agent_id, error=str(e), exc_info=True)
        else:
            logger.error("agent_websocket_error_before_auth", website_id=website_id, error=str(e), exc_info=True)
    finally:
        try:
            ws_disconnect(kind="agent")
        except Exception:
            pass
        if agent_service and websocket_id:
            agent_service.unregister_agent(websocket_id)
        db.close()
        if agent_id:
            logger.info("agent_cleanup_complete", agent_id=agent_id)

        try:
            structlog.contextvars.clear_contextvars()
        except Exception:
            pass
