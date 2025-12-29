#!/usr/bin/env python3
"""
Test script for Step 2.2 - Inactivity Timeout & AI Resumption

This script verifies:
1. Agent active → AI blocked
2. Agent inactive → AI resumes automatically
3. Visitor message triggers auto-release
4. System message added on auto-release
5. Agent must re-claim after timeout
6. Timestamp tracking works correctly
7. AI disabled websites → WAITING_FOR_AGENT after timeout
8. No false resumption if agent just replied
"""

import sys
import time
from datetime import datetime, timedelta
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.conversation import Conversation, ConversationStatus, ConversationMode
from app.models.message import Message, MessageSenderType
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.services.conversation_service import ConversationService
from app.services.website_resolver import is_website_online
from app.services.connection_manager import mark_connected, mark_disconnected
from app.core.config import settings
from app.core.security import get_password_hash


def test_inactivity_timeout():
    print("=" * 60)
    print("TESTING STEP 2.2 - INACTIVITY TIMEOUT & AI RESUMPTION")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Setup: Create test data
        print("\n[SETUP] Creating test data")
        print(f"  - Timeout threshold: {settings.AGENT_INACTIVITY_TIMEOUT_SECONDS} seconds")
        
        # Clean up existing test data
        db.query(Message).filter(
            Message.conversation_id.in_(
                db.query(Conversation.id).filter(Conversation.session_id.like('%test-timeout%'))
            )
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.session_id.like('%test-timeout%')).delete()
        db.query(AgentWebsiteAssignment).filter(
            AgentWebsiteAssignment.website_id.in_(
                db.query(Website.id).filter(Website.domain.like('%test-timeout.local'))
            )
        ).delete(synchronize_session=False)
        db.query(Website).filter(Website.domain.like('%test-timeout.local')).delete()
        db.query(User).filter(User.email.like('%@test-timeout.local')).delete()
        db.commit()
        
        # Create test websites
        website_ai = Website(
            name="Test Website with AI",
            domain="ai.test-timeout.local",
            ai_instructions="You are a helpful assistant."
        )
        website_no_ai = Website(
            name="Test Website without AI",
            domain="no-ai.test-timeout.local",
            ai_instructions=""
        )
        db.add_all([website_ai, website_no_ai])
        db.commit()
        db.refresh(website_ai)
        db.refresh(website_no_ai)
        
        # Create test agent
        agent = User(
            name="Test Agent",
            email="agent@test-timeout.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        
        # Assign agent to websites
        for website in [website_ai, website_no_ai]:
            assignment = AgentWebsiteAssignment(agent_id=agent.id, website_id=website.id)
            db.add(assignment)
        db.commit()
        
        mark_connected(agent.id)
        
        print(f"  - Created website_ai: {website_ai.domain}")
        print(f"  - Created website_no_ai: {website_no_ai.domain}")
        print(f"  - Created agent: {agent.email}")
        
        # Initialize service
        conversation_service = ConversationService(db)
        
        # Test 1: Create conversation and claim it
        print("\n[TEST 1] Create WAITING_FOR_AGENT conversation and claim")
        conv = conversation_service.get_or_create_conversation(
            website_id=website_no_ai.id,
            session_id="session-timeout-test"
        )
        
        assert conv.mode == ConversationMode.WAITING_FOR_AGENT
        
        # Claim conversation
        success, message = conversation_service.claim_conversation(
            conversation_id=conv.id,
            agent_id=agent.id,
            agent_name=agent.name
        )
        
        assert success == True
        db.refresh(conv)
        assert conv.mode == ConversationMode.AGENT_HANDLING
        print(f"  - Conversation claimed: mode={conv.mode.value}")
        print("  ✓ PASS: Conversation claimed successfully")
        
        # Test 2: Agent sends message (sets timestamp)
        print("\n[TEST 2] Agent sends message - timestamp updated")
        agent_msg = conversation_service.add_agent_message(
            conversation_id=conv.id,
            agent_id=agent.id,
            agent_email=agent.email,
            content="Hello! How can I help?"
        )
        
        db.refresh(conv)
        print(f"  - last_agent_message_at: {conv.last_agent_message_at}")
        assert conv.last_agent_message_at is not None
        assert agent_msg is not None
        print("  ✓ PASS: Agent timestamp updated")
        
        # Test 3: Agent active (just replied) → AI still blocked
        print("\n[TEST 3] Agent just replied → not inactive yet")
        is_inactive = conversation_service.is_agent_inactive(conv)
        print(f"  - is_agent_inactive: {is_inactive}")
        assert is_inactive == False
        print("  ✓ PASS: Agent not considered inactive")
        
        # Test 4: Visitor sends message while agent active → no auto-release
        print("\n[TEST 4] Visitor message while agent active → no auto-release")
        visitor_msg = conversation_service.add_visitor_message(
            conversation_id=conv.id,
            content="I have a question"
        )
        
        db.refresh(conv)
        print(f"  - Conversation mode: {conv.mode.value}")
        print(f"  - Assigned agent: {conv.assigned_agent_id}")
        assert conv.mode == ConversationMode.AGENT_HANDLING
        assert conv.assigned_agent_id == agent.id
        print("  ✓ PASS: No auto-release when agent active")
        
        # Test 5: Simulate timeout by backdating timestamp
        print("\n[TEST 5] Backdate agent timestamp to simulate timeout")
        old_time = datetime.utcnow() - timedelta(seconds=settings.AGENT_INACTIVITY_TIMEOUT_SECONDS + 60)
        conv.last_agent_message_at = old_time
        db.commit()
        db.refresh(conv)
        
        is_inactive = conversation_service.is_agent_inactive(conv)
        print(f"  - Backdated timestamp: {old_time}")
        print(f"  - is_agent_inactive: {is_inactive}")
        assert is_inactive == True
        print("  ✓ PASS: Agent now considered inactive")
        
        # Test 6: Visitor message triggers auto-release
        print("\n[TEST 6] Visitor message triggers auto-release to WAITING_FOR_AGENT")
        visitor_msg2 = conversation_service.add_visitor_message(
            conversation_id=conv.id,
            content="Anyone there?"
        )
        
        db.refresh(conv)
        print(f"  - Conversation mode after: {conv.mode.value}")
        print(f"  - Assigned agent after: {conv.assigned_agent_id}")
        assert conv.mode == ConversationMode.WAITING_FOR_AGENT  # No AI, so goes to waiting
        assert conv.assigned_agent_id is None
        print("  ✓ PASS: Auto-released to WAITING_FOR_AGENT (AI disabled)")
        
        # Test 7: System message added on auto-release
        print("\n[TEST 7] System message added on auto-release")
        messages = db.query(Message).filter_by(conversation_id=conv.id).order_by(Message.created_at.desc()).all()
        system_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM]
        
        release_messages = [m for m in system_messages if "agent will be with you" in m.content.lower() or "assistant" in m.content.lower()]
        
        print(f"  - Total system messages: {len(system_messages)}")
        print(f"  - Release-related messages: {len(release_messages)}")
        if release_messages:
            print(f"  - Release message: {release_messages[0].content}")
        
        assert len(release_messages) > 0
        print("  ✓ PASS: System message created on auto-release")
        
        # Test 8: Agent cannot message after auto-release
        print("\n[TEST 8] Agent cannot message after auto-release")
        can_message, reason = conversation_service.can_agent_message(conv.id, agent.id)
        print(f"  - Can agent message: {can_message} ({reason})")
        assert can_message == False
        assert "claim" in reason.lower()
        print("  ✓ PASS: Agent must re-claim")
        
        # Test 9: Test with AI-enabled website
        print("\n[TEST 9] Auto-release to AI_HANDLING when AI enabled")
        
        # Create AI-enabled conversation
        conv_ai = conversation_service.get_or_create_conversation(
            website_id=website_ai.id,
            session_id="session-ai-timeout-test"
        )
        
        # Force it to AGENT_HANDLING
        conv_ai.mode = ConversationMode.AGENT_HANDLING
        conv_ai.assigned_agent_id = agent.id
        conv_ai.last_agent_message_at = old_time  # Already inactive
        db.commit()
        db.refresh(conv_ai)
        
        # Visitor message triggers auto-release to AI
        visitor_msg_ai = conversation_service.add_visitor_message(
            conversation_id=conv_ai.id,
            content="Hello again"
        )
        
        db.refresh(conv_ai)
        print(f"  - Mode after auto-release: {conv_ai.mode.value}")
        assert conv_ai.mode == ConversationMode.AI_HANDLING  # AI enabled, so AI resumes
        print("  ✓ PASS: Auto-released to AI_HANDLING (AI enabled)")
        
        # Test 10: Timestamp tracking for visitor messages
        print("\n[TEST 10] Visitor message timestamp tracking")
        db.refresh(conv)
        print(f"  - last_visitor_message_at: {conv.last_visitor_message_at}")
        assert conv.last_visitor_message_at is not None
        print("  ✓ PASS: Visitor timestamp tracked")
        
        # Test 11: Agent can re-claim after auto-release
        print("\n[TEST 11] Agent can re-claim after auto-release")
        success, message = conversation_service.claim_conversation(
            conversation_id=conv.id,
            agent_id=agent.id,
            agent_name=agent.name
        )
        
        print(f"  - Re-claim success: {success}")
        assert success == True
        db.refresh(conv)
        assert conv.mode == ConversationMode.AGENT_HANDLING
        print("  ✓ PASS: Agent can re-claim")
        
        # Test 12: Config value is used
        print("\n[TEST 12] Config value is respected")
        print(f"  - AGENT_INACTIVITY_TIMEOUT_SECONDS: {settings.AGENT_INACTIVITY_TIMEOUT_SECONDS}")
        assert settings.AGENT_INACTIVITY_TIMEOUT_SECONDS == 15 * 60  # 15 minutes
        print("  ✓ PASS: Config value correct")
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        
        print("\n📋 KEY TAKEAWAYS:")
        print("  1. Agent ownership is temporary (not permanent)")
        print("  2. Inactivity detected at message-time (not background job)")
        print("  3. Auto-release happens when visitor sends message")
        print("  4. AI resumes if enabled, otherwise WAITING_FOR_AGENT")
        print("  5. Agent must re-claim after auto-release")
        print("  6. System messages explain what happened")
        
        print("\n⚠️  CRITICAL RULES:")
        print("  - Timeout = 15 minutes by default (configurable)")
        print("  - Visitor always gets response (never stuck)")
        print("  - Agent notified via system message")
        print("  - Clean state transitions, no corruption")
        
        # Cleanup
        print("\n[CLEANUP] Removing test data")
        mark_disconnected(agent.id)
        db.query(Message).filter(
            Message.conversation_id.in_([conv.id, conv_ai.id])
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.id.in_([conv.id, conv_ai.id])).delete()
        db.query(AgentWebsiteAssignment).filter(AgentWebsiteAssignment.website_id.in_([website_ai.id, website_no_ai.id])).delete()
        db.query(Website).filter(Website.id.in_([website_ai.id, website_no_ai.id])).delete()
        db.query(User).filter_by(id=agent.id).delete()
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
    test_inactivity_timeout()
