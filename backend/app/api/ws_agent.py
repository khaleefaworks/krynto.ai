from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService
from app.models.message import Message
import json
import traceback

router = APIRouter()


@router.websocket("/ws/agent/{website_id}/{agent_id}")
async def agent_ws(
    websocket: WebSocket,
    website_id: int,
    agent_id: int,
):
    await websocket.accept()
    print(f"✅ Agent WebSocket connected: agent_id={agent_id}, website_id={website_id}")

    db = SessionLocal()
    agent_service = AgentService(db)
    
    try:
        # Register agent connection
        websocket_id = agent_service.register_agent(agent_id, website_id, websocket)
        print(f"✅ Agent registered with websocket_id={websocket_id}")
        
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
            print(f"📥 Agent message received: {data}")
            payload = json.loads(data)
            
            message_type = payload.get("type")
            
            if message_type == "join_chat":
                # Agent joining a conversation
                conversation_id = payload.get("conversation_id")
                print(f"🔗 Agent {agent_id} joining conversation {conversation_id}")
                
                # Mark conversation as handoff
                conversation = agent_service.assign_conversation_to_agent(
                    conversation_id, agent_id
                )
                
                # Get conversation history
                messages = agent_service.get_conversation_messages(conversation_id)
                history = [
                    {
                        "sender": msg.sender,
                        "content": msg.content,
                        "created_at": msg.created_at.isoformat() if msg.created_at else None
                    }
                    for msg in messages
                ]
                
                # Send confirmation with history
                await websocket.send_json({
                    "type": "joined",
                    "conversation_id": conversation_id,
                    "history": history
                })
                
                # Notify visitor that agent joined
                chat_service = ChatService.get_by_conversation_id(db, conversation_id)
                if chat_service:
                    await chat_service.send_to_visitor({
                        "type": "agent_joined",
                        "message": "An agent has joined the chat"
                    })
            
            elif message_type == "message":
                # Agent sending message to visitor
                conversation_id = payload.get("conversation_id")
                content = payload.get("content")
                
                if not content or not conversation_id:
                    continue
                
                print(f"💬 Agent sending message to conversation {conversation_id}")
                
                # Save agent message
                message = Message(
                    conversation_id=conversation_id,
                    sender="agent",
                    content=content
                )
                db.add(message)
                db.commit()
                
                # Forward to visitor
                chat_service = ChatService.get_by_conversation_id(db, conversation_id)
                if chat_service:
                    await chat_service.send_to_visitor({
                        "type": "agent",
                        "message": content
                    })
                    print("✅ Message forwarded to visitor")

    except WebSocketDisconnect:
        print(f"🔌 Agent {agent_id} disconnected")
    except Exception as e:
        print(f"❌ Error in agent WebSocket: {e}")
        traceback.print_exc()
    finally:
        agent_service.unregister_agent(websocket_id)
        db.close()
        print(f"✅ Agent {agent_id} cleanup complete")
