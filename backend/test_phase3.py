#!/usr/bin/env python3
"""Phase 3 - Agent Handoff Test"""
import asyncio
import json
import websockets
import requests
from datetime import datetime


BASE_URL = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"


def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


async def test_phase3():
    print_section("🧪 PHASE 3 - AGENT HANDOFF TEST")
    
    # Step 1: Start visitor chat with AI
    print_section("Step 1: Visitor Chat with AI")
    visitor_ws = await websockets.connect(f"{WS_BASE}/ws/chat/1/phase3-test-{datetime.now().timestamp()}")
    print("✅ Visitor connected")
    
    # Visitor sends first message
    await visitor_ws.send(json.dumps({"message": "Hello, I need help!"}))
    response = await visitor_ws.recv()
    data = json.loads(response)
    print(f"📥 AI Response: {data['message'][:50]}...")
    
    # Get conversation ID from database
    # In real scenario, we'd track this from WebSocket, but for testing we'll query API
    active_chats = requests.get(f"{BASE_URL}/chats/active?website_id=1").json()
    if not active_chats:
        print("❌ No active chats found")
        return
    
    conversation_id = active_chats[0]["id"]
    print(f"✅ Conversation ID: {conversation_id}")
    
    # Step 2: Agent connects
    print_section("Step 2: Agent Connection")
    agent_ws = await websockets.connect(f"{WS_BASE}/ws/agent/1/100")
    print("✅ Agent WebSocket connected")
    
    agent_welcome = await agent_ws.recv()
    print(f"📥 Agent welcome: {json.loads(agent_welcome)}")
    
    # Step 3: Agent joins the chat
    print_section("Step 3: Agent Joins Chat (Handoff)")
    
    # Agent sends join request via WebSocket
    await agent_ws.send(json.dumps({
        "type": "join_chat",
        "conversation_id": conversation_id
    }))
    
    join_response = await agent_ws.recv()
    join_data = json.loads(join_response)
    print(f"📥 Join confirmation: {join_data['type']}")
    print(f"   History messages: {len(join_data.get('history', []))}")
    
    # Visitor should receive "agent joined" notification
    agent_joined_msg = await visitor_ws.recv()
    print(f"📥 Visitor notified: {json.loads(agent_joined_msg)}")
    
    # Step 4: Visitor sends message (should go to agent, NOT AI)
    print_section("Step 4: Visitor Message → Agent (AI PAUSED)")
    
    await visitor_ws.send(json.dumps({"message": "Can you help with my order?"}))
    print("📤 Visitor sent message")
    
    # Agent should receive this message
    agent_msg = await agent_ws.recv()
    agent_msg_data = json.loads(agent_msg)
    print(f"📥 Agent received: {agent_msg_data}")
    assert agent_msg_data["type"] == "visitor_message", "❌ Agent did not receive visitor message"
    print("✅ Message routed to agent (AI did NOT respond)")
    
    # Step 5: Agent replies to visitor
    print_section("Step 5: Agent → Visitor")
    
    await agent_ws.send(json.dumps({
        "type": "message",
        "conversation_id": conversation_id,
        "content": "Hello! I'm a human agent. Let me help you with your order."
    }))
    print("📤 Agent sent reply")
    
    # Visitor should receive agent's message
    visitor_response = await visitor_ws.recv()
    visitor_response_data = json.loads(visitor_response)
    print(f"📥 Visitor received: {visitor_response_data}")
    assert visitor_response_data["type"] == "agent", "❌ Visitor did not receive agent message"
    print("✅ Agent message delivered to visitor")
    
    # Step 6: Verify conversation state
    print_section("Step 6: Verify Handoff State")
    
    conversation_details = requests.get(f"{BASE_URL}/chats/{conversation_id}/messages").json()
    print(f"✅ Total messages in conversation: {len(conversation_details)}")
    
    senders = [msg["sender"] for msg in conversation_details]
    print(f"   Message senders: {senders}")
    
    assert "agent" in senders, "❌ No agent messages found"
    assert "visitor" in senders, "❌ No visitor messages found"
    
    # Close connections
    await visitor_ws.close()
    await agent_ws.close()
    
    print_section("✅ PHASE 3 TEST PASSED")
    print("All handoff features working:")
    print("  ✅ Agent WebSocket connection")
    print("  ✅ Agent joins chat")
    print("  ✅ AI stops responding (handoff)")
    print("  ✅ Messages route to agent")
    print("  ✅ Agent messages reach visitor")
    print("  ✅ Conversation history preserved")


if __name__ == "__main__":
    try:
        asyncio.run(test_phase3())
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
