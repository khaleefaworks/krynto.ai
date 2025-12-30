from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.agent_service import AgentService
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.core.logging import get_logger
import json
import traceback

router = APIRouter()
logger = get_logger(__name__)


@router.websocket("/ws/agent/{website_id}/{agent_id}")
async def agent_ws(
    websocket: WebSocket,
    website_id: int,
    agent_id: int,
):
    await websocket.accept()
    logger.info("agent_websocket_connected", agent_id=agent_id, website_id=website_id)

    db = SessionLocal()
    agent_service = AgentService(db)
    orchestrator = ConversationOrchestrator(db)
    
    try:
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

                if not content or not conversation_id:
                    continue

                logger.info("agent_sending_message", agent_id=agent_id, conversation_id=conversation_id, content_length=len(content))

                result = await orchestrator.handle_agent_message(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                    content=content,
                )

                if result.get("error"):
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    continue

    except WebSocketDisconnect:
        logger.info("agent_disconnected", agent_id=agent_id)
    except Exception as e:
        logger.error("agent_websocket_error", agent_id=agent_id, error=str(e), exc_info=True)
        traceback.print_exc()
    finally:
        agent_service.unregister_agent(websocket_id)
        db.close()
        logger.info("agent_cleanup_complete", agent_id=agent_id)
