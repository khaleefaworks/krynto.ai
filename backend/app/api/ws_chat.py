from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.chat_service import ChatService
import json
import traceback

router = APIRouter()


@router.websocket("/ws/chat/{website_id}/{session_id}")
async def chat_ws(
    websocket: WebSocket,
    website_id: int,
    session_id: str,
):
    await websocket.accept()
    print(f"✅ WebSocket connected: website_id={website_id}, session_id={session_id}")

    db = SessionLocal()
    
    try:
        chat_service = ChatService(db, website_id, session_id)
        print(f"✅ ChatService initialized, conversation_id={chat_service.conversation.id}")
    except Exception as e:
        print(f"❌ Error initializing ChatService: {e}")
        traceback.print_exc()
        db.close()
        await websocket.close(code=1011, reason=str(e))
        return

    try:
        while True:
            data = await websocket.receive_text()
            print(f"📥 Received data: {data}")
            payload = json.loads(data)

            user_message = payload.get("message")
            if not user_message:
                continue

            print(f"💬 Processing message: {user_message}")
            response = await chat_service.handle_visitor_message(user_message)
            print(f"🤖 AI response: {response}")

            await websocket.send_json({
                "type": "ai",
                "message": response
            })
            print("✅ Response sent")

    except WebSocketDisconnect:
        print("🔌 WebSocket disconnected")
        chat_service.close_session()
    except Exception as e:
        print(f"❌ Error in WebSocket handler: {e}")
        traceback.print_exc()
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
    finally:
        db.close()
