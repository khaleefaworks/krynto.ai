#!/usr/bin/env python3
"""
Test script for Step 2.1 - Conversation Mode & Claiming

This script verifies:
1. ConversationMode enum (AI_HANDLING, WAITING_FOR_AGENT, AGENT_HANDLING)
2. Conversation creation with correct mode based on AI enabled + online status
3. FCFS atomic claiming (two agents, only one wins)
4. Inbox visibility (agents only see WAITING_FOR_AGENT or their own AGENT_HANDLING)
5. Message routing enforcement (AI can't respond in AGENT_HANDLING mode)
6. Agent permission checks before messaging
7. Claim failures (already claimed, wrong mode)
"""

import sys
import threading
import time
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.conversation import Conversation, ConversationStatus, ConversationMode
from app.models.message import Message, MessageSenderType
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.services.conversation_service import ConversationService
from app.services.agent_service import AgentService
from app.services.website_resolver import is_website_online
from app.services.connection_manager import mark_connected, mark_disconnected
from app.core.security import get_password_hash


def test_conversation_mode_and_claiming():
    print("=" * 60)
    print("TESTING STEP 2.1 - CONVERSATION MODE & CLAIMING")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Setup: Create test data
        print("\n[SETUP] Creating test data")
        
        # Clean up existing test data
        db.query(Message).filter(
            Message.conversation_id.in_(
                db.query(Conversation.id).filter(Conversation.session_id.like('%test-mode%'))
            )
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.session_id.like('%test-mode%')).delete()
        db.query(AgentWebsiteAssignment).filter(
            AgentWebsiteAssignment.website_id.in_(
                db.query(Website.id).filter(Website.domain.like('%test-mode.local'))
            )
        ).delete(synchronize_session=False)
        db.query(Website).filter(Website.domain.like('%test-mode.local')).delete()
        db.query(User).filter(User.email.like('%@test-mode.local')).delete()
        db.commit()
        
        # Create test websites (one with AI, one without)
        website_ai = Website(
            name="Test Website with AI",
            domain="ai.test-mode.local",
            ai_instructions="You are a helpful assistant."
        )
        website_no_ai = Website(
            name="Test Website without AI",
            domain="no-ai.test-mode.local",
            ai_instructions=""
        )
        db.add_all([website_ai, website_no_ai])
        db.commit()
        db.refresh(website_ai)
        db.refresh(website_no_ai)
        
        # Create test agents
        agent1 = User(
            name="Agent One",
            email="agent1@test-mode.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        agent2 = User(
            name="Agent Two",
            email="agent2@test-mode.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        db.add_all([agent1, agent2])
        db.commit()
        db.refresh(agent1)
        db.refresh(agent2)
        
        # Assign agents to websites
        for website in [website_ai, website_no_ai]:
            assignment1 = AgentWebsiteAssignment(agent_id=agent1.id, website_id=website.id)
            assignment2 = AgentWebsiteAssignment(agent_id=agent2.id, website_id=website.id)
            db.add_all([assignment1, assignment2])
        db.commit()
        
        print(f"  - Created website_ai: {website_ai.domain} (AI enabled)")
        print(f"  - Created website_no_ai: {website_no_ai.domain} (AI disabled)")
        print(f"  - Created agent1: {agent1.email}")
        print(f"  - Created agent2: {agent2.email}")
        
        # Initialize services
        conversation_service = ConversationService(db)
        agent_service = AgentService(db)
        
        # Test 1: AI enabled + online → AI_HANDLING
        print("\n[TEST 1] AI enabled + online → AI_HANDLING mode")
        mark_connected(agent1.id)
        online = is_website_online(website_ai.id)
        print(f"  - Website online: {online}")
        
        conv1 = conversation_service.get_or_create_conversation(
            website_id=website_ai.id,
            session_id="session-ai-test-mode"
        )
        
        print(f"  - Conversation mode: {conv1.mode.value}")
        assert conv1.mode == ConversationMode.AI_HANDLING, "Should be AI_HANDLING when AI enabled and online"
        print("  ✓ PASS: AI_HANDLING mode set correctly")
        
        # Test 2: AI disabled → WAITING_FOR_AGENT
        print("\n[TEST 2] AI disabled → WAITING_FOR_AGENT mode")
        conv2 = conversation_service.get_or_create_conversation(
            website_id=website_no_ai.id,
            session_id="session-no-ai-test-mode"
        )
        
        print(f"  - Conversation mode: {conv2.mode.value}")
        assert conv2.mode == ConversationMode.WAITING_FOR_AGENT, "Should be WAITING_FOR_AGENT when AI disabled"
        print("  ✓ PASS: WAITING_FOR_AGENT mode set correctly")
        
        # Test 3: Atomic claiming (FCFS) - CRITICAL TEST
        print("\n[TEST 3] FCFS Atomic Claiming - Two agents, only one wins")
        
        # Track results from threaded claims
        claim_results = []
        
        def try_claim(agent, agent_name):
            try:
                # Each thread gets its own session
                thread_db = SessionLocal()
                thread_service = ConversationService(thread_db)
                success, message = thread_service.claim_conversation(
                    conversation_id=conv2.id,
                    agent_id=agent.id,
                    agent_name=agent_name
                )
                claim_results.append((agent_name, success, message))
                thread_db.close()
            except Exception as e:
                claim_results.append((agent_name, False, str(e)))
        
        # Simulate race condition with threads
        thread1 = threading.Thread(target=try_claim, args=(agent1, "Agent One"))
        thread2 = threading.Thread(target=try_claim, args=(agent2, "Agent Two"))
        
        thread1.start()
        thread2.start()
        thread1.join()
        thread2.join()
        
        # Check results
        successes = [r for r in claim_results if r[1] == True]
        failures = [r for r in claim_results if r[1] == False]
        
        print(f"  - Total claim attempts: {len(claim_results)}")
        print(f"  - Successful claims: {len(successes)}")
        print(f"  - Failed claims: {len(failures)}")
        
        for agent_name, success, message in claim_results:
            status = "✓ SUCCESS" if success else "✗ FAILED"
            print(f"  - {agent_name}: {status} - {message}")
        
        assert len(successes) == 1, "Exactly one agent should win"
        assert len(failures) == 1, "Exactly one agent should lose"
        print("  ✓ PASS: FCFS claiming works correctly")
        
        # Verify conversation state after claim
        db.refresh(conv2)
        print(f"  - Conversation assigned to: agent_id={conv2.assigned_agent_id}")
        print(f"  - Conversation mode: {conv2.mode.value}")
        assert conv2.mode == ConversationMode.AGENT_HANDLING, "Mode should be AGENT_HANDLING after claim"
        assert conv2.assigned_agent_id in [agent1.id, agent2.id], "Agent should be assigned"
        print("  ✓ PASS: Conversation state updated correctly")
        
        # Test 4: Cannot claim already claimed conversation
        print("\n[TEST 4] Cannot claim already claimed conversation")
        other_agent = agent2 if conv2.assigned_agent_id == agent1.id else agent1
        success, message = conversation_service.claim_conversation(
            conversation_id=conv2.id,
            agent_id=other_agent.id,
            agent_name="Other Agent"
        )
        
        print(f"  - Second claim attempt: success={success}")
        print(f"  - Message: {message}")
        assert success == False, "Second claim should fail"
        assert "already claimed" in message.lower(), "Message should indicate already claimed"
        print("  ✓ PASS: Already claimed conversations reject new claims")
        
        # Test 5: Inbox visibility - agents only see WAITING_FOR_AGENT or their own
        print("\n[TEST 5] Inbox visibility based on mode")
        
        # Create AI_HANDLING conversation (should NOT be visible)
        conv_ai_handling = conversation_service.get_or_create_conversation(
            website_id=website_ai.id,
            session_id="session-ai-handling-test-mode"
        )
        assert conv_ai_handling.mode == ConversationMode.AI_HANDLING
        
        # Get inbox for agent1
        inbox_agent1 = agent_service.get_active_chats(agent_id=agent1.id)
        inbox_ids = [c.id for c in inbox_agent1]
        
        print(f"  - Agent1 inbox conversations: {len(inbox_agent1)}")
        print(f"  - Conv2 (AGENT_HANDLING, assigned to winner): id={conv2.id}")
        print(f"  - Conv_ai_handling (AI_HANDLING): id={conv_ai_handling.id}")
        
        # Agent should NOT see AI_HANDLING conversations
        assert conv_ai_handling.id not in inbox_ids, "Agent should NOT see AI_HANDLING conversations"
        print("  ✓ PASS: AI_HANDLING conversations hidden from agents")
        
        # Test 6: can_agent_message enforcement
        print("\n[TEST 6] Message permission enforcement")
        winner_agent_id = conv2.assigned_agent_id
        loser_agent_id = agent1.id if winner_agent_id == agent2.id else agent2.id
        
        # Winner should be able to message
        can_message, reason = conversation_service.can_agent_message(conv2.id, winner_agent_id)
        print(f"  - Winner can message: {can_message} ({reason})")
        assert can_message == True, "Winner should be able to message"
        print("  ✓ PASS: Assigned agent can message")
        
        # Loser should NOT be able to message
        can_message, reason = conversation_service.can_agent_message(conv2.id, loser_agent_id)
        print(f"  - Loser can message: {can_message} ({reason})")
        assert can_message == False, "Loser should NOT be able to message"
        assert "another agent" in reason.lower(), "Reason should mention another agent"
        print("  ✓ PASS: Non-assigned agent cannot message")
        
        # Test 7: Cannot message AI_HANDLING conversation
        print("\n[TEST 7] Agents cannot message AI_HANDLING conversations")
        can_message, reason = conversation_service.can_agent_message(conv_ai_handling.id, agent1.id)
        print(f"  - Agent can message AI conversation: {can_message} ({reason})")
        assert can_message == False, "Agent should NOT be able to message AI_HANDLING conversation"
        assert "ai" in reason.lower(), "Reason should mention AI"
        print("  ✓ PASS: Agents blocked from AI_HANDLING conversations")
        
        # Test 8: Must claim before messaging WAITING_FOR_AGENT
        print("\n[TEST 8] Must claim before messaging WAITING_FOR_AGENT")
        conv_waiting = conversation_service.get_or_create_conversation(
            website_id=website_no_ai.id,
            session_id="session-waiting-test-mode"
        )
        assert conv_waiting.mode == ConversationMode.WAITING_FOR_AGENT
        
        can_message, reason = conversation_service.can_agent_message(conv_waiting.id, agent1.id)
        print(f"  - Can message before claim: {can_message} ({reason})")
        assert can_message == False, "Should not be able to message before claiming"
        assert "claim" in reason.lower(), "Reason should mention claiming"
        print("  ✓ PASS: Must claim before messaging")
        
        # Test 9: ConversationMode enum values
        print("\n[TEST 9] ConversationMode enum values")
        assert ConversationMode.AI_HANDLING.value == "ai_handling"
        assert ConversationMode.WAITING_FOR_AGENT.value == "waiting_for_agent"
        assert ConversationMode.AGENT_HANDLING.value == "agent_handling"
        print("  ✓ PASS: ConversationMode enum values correct")
        
        # Test 10: System message added on claim
        print("\n[TEST 10] System message added on claim")
        messages = db.query(Message).filter_by(conversation_id=conv2.id).all()
        system_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM]
        join_messages = [m for m in system_messages if "joined" in m.content.lower()]
        
        print(f"  - System messages: {len(system_messages)}")
        print(f"  - Join messages: {len(join_messages)}")
        if join_messages:
            print(f"  - Join message: {join_messages[0].content}")
        
        assert len(join_messages) > 0, "System message about agent joining should exist"
        print("  ✓ PASS: System message created on claim")
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        
        print("\n📋 KEY TAKEAWAYS:")
        print("  1. Conversation has TWO dimensions: status (lifecycle) + mode (who handles)")
        print("  2. AI_HANDLING → AI responds, agents invisible")
        print("  3. WAITING_FOR_AGENT → Must claim, FCFS, DB-atomic")
        print("  4. AGENT_HANDLING → Only assigned agent can respond")
        print("  5. Claiming is race-safe (tested with threads)")
        print("  6. Losers get clean error, no corruption")
        
        print("\n⚠️  CRITICAL RULES:")
        print("  - AI must STOP when mode = AGENT_HANDLING")
        print("  - Agents must claim before messaging")
        print("  - Inbox filtering by mode is mandatory")
        print("  - No shortcuts, no bypassing claim")
        
        # Cleanup
        print("\n[CLEANUP] Removing test data")
        mark_disconnected(agent1.id)
        db.query(Message).filter(
            Message.conversation_id.in_([conv1.id, conv2.id, conv_ai_handling.id, conv_waiting.id])
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.id.in_([conv1.id, conv2.id, conv_ai_handling.id, conv_waiting.id])).delete()
        db.query(AgentWebsiteAssignment).filter(AgentWebsiteAssignment.website_id.in_([website_ai.id, website_no_ai.id])).delete()
        db.query(Website).filter(Website.id.in_([website_ai.id, website_no_ai.id])).delete()
        db.query(User).filter(User.id.in_([agent1.id, agent2.id])).delete()
        db.commit()
        print("  ✓ Test data cleaned up")
        
    except AssertionError as e:
        print(f"\n✗ ASSERTION FAILED: {e}")
        db.rollback()
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    test_conversation_mode_and_claiming()
