from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.core.logging import get_logger
from app.core.ws_auth import authenticate_websocket, extract_token_from_query
from app.models.user import UserRole
import json
import traceback

router = APIRouter()
logger = get_logger(__name__)


@router.websocket("/ws/agent/{website_id}")
async def agent_ws(
    websocket: WebSocket,
    website_id: int,
):
    await websocket.accept()
    logger.info("agent_websocket_connection_attempt", website_id=website_id)

    db = SessionLocal()
    agent_id = None
    websocket_id = None
    agent_service = None
    
    try:
        # Authenticate WebSocket connection - agent_id comes from JWT token
        token = extract_token_from_query(websocket)
        user = await authenticate_websocket(
            websocket, 
            db, 
            token=token,
            required_roles=[UserRole.AGENT, UserRole.SYSTEM_MANAGER, UserRole.MANAGER]
        )
        
        if not user:
            # authenticate_websocket already sent error and closed connection
            db.close()
            return
        
        # Use agent_id from authenticated token, not URL
        agent_id = user.id
        logger.info("agent_websocket_authenticated", agent_id=agent_id, website_id=website_id, email=user.email)
        
        agent_service = AgentService(db)
        orchestrator = ConversationOrchestrator(db)
        
        # Register agent connection
        websocket_id = agent_service.register_agent(agent_id, website_id, websocket)
        logger.info("agent_registered", agent_id=agent_id, websocket_id=websocket_id, website_id=website_id)
        
        # Send confirmation
        await websocket.send_json({
            "type": "connected",
            "agent_id": agent_id,
            "website_id": website_id,
            "message": "Agent connected successfully"
        })
        
        # Listen for agent messages
        while True:
            data = await websocket.receive_text()
            logger.debug("agent_message_received", agent_id=agent_id, data=data)
            payload = json.loads(data)
            
            message_type = payload.get("type")
            
            if message_type == "join_chat":
                conversation_id = payload.get("conversation_id")
                logger.info("agent_joining_conversation", agent_id=agent_id, conversation_id=conversation_id)

                result = await orchestrator.handle_agent_join(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                )

                if result.get("error"):
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    continue

                messages = agent_service.get_conversation_messages(conversation_id)
                history = [
                    {
                        "sender": msg.sender,
                        "content": msg.content,
                        "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    }
                    for msg in messages
                ]

                await websocket.send_json(
                    {
                        "type": "joined",
                        "conversation_id": conversation_id,
                        "history": history,
                    }
                )

            elif message_type == "message":
                conversation_id = payload.get("conversation_id")
                content = payload.get("content")
                message_id = payload.get("message_id")  # Extract message ID for acknowledgment

                if not content or not conversation_id:
                    continue

                # Send acknowledgment immediately
                if message_id:
                    await websocket.send_json({
                        "type": "ack",
                        "message_id": message_id
                    })

                logger.info("agent_sending_message", agent_id=agent_id, conversation_id=conversation_id, content_length=len(content), message_id=message_id)

                result = await orchestrator.handle_agent_message(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                    content=content,
                )

                if result.get("error"):
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    continue
                
                # Send confirmation back to agent
                await websocket.send_json({
                    "type": "message_sent",
                    "conversation_id": conversation_id,
                    "content": content,
                    "success": True
                })

    except WebSocketDisconnect:
        if agent_id:
            logger.info("agent_disconnected", agent_id=agent_id)
    except Exception as e:
        if agent_id:
            logger.error("agent_websocket_error", agent_id=agent_id, error=str(e), exc_info=True)
        else:
            logger.error("agent_websocket_error_before_auth", website_id=website_id, error=str(e), exc_info=True)
        traceback.print_exc()
    finally:
        if agent_service and websocket_id:
            agent_service.unregister_agent(websocket_id)
        db.close()
        if agent_id:
            logger.info("agent_cleanup_complete", agent_id=agent_id)
