#!/usr/bin/env python3
"""
Test script for Step 1.5 - Conversation State Expansion

This script verifies:
1. ConversationStatus enum (ACTIVE, OFFLINE, CLOSED)
2. MessageSenderType enum (VISITOR, AGENT, SYSTEM)
3. Conversation creation based on website online status
4. System messages for offline conversations
5. State transitions (OFFLINE → ACTIVE)
6. Close conversation logic
7. Message rejection for closed conversations
8. Agent message triggers OFFLINE → ACTIVE transition
"""

import sys
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.services.conversation_service import ConversationService
from app.services.website_resolver import is_website_online
from app.services.connection_manager import mark_connected, mark_disconnected
from app.core.security import get_password_hash


def test_conversation_state_expansion():
    print("=" * 60)
    print("TESTING STEP 1.5 - CONVERSATION STATE EXPANSION")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Setup: Create test data
        print("\n[SETUP] Creating test data")
        
        # Clean up existing test data
        db.query(Message).filter(
            Message.conversation_id.in_(
                db.query(Conversation.id).filter(Conversation.session_id.like('%test-state%'))
            )
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.session_id.like('%test-state%')).delete()
        db.query(AgentWebsiteAssignment).filter(
            AgentWebsiteAssignment.website_id.in_(
                db.query(Website.id).filter(Website.domain.like('%test-state.local'))
            )
        ).delete(synchronize_session=False)
        db.query(Website).filter(Website.domain.like('%test-state.local')).delete()
        db.query(User).filter(User.email.like('%@test-state.local')).delete()
        db.commit()
        
        # Create test website
        website = Website(
            name="Test Website State",
            domain="site.test-state.local",
            ai_instructions="Test instructions"
        )
        db.add(website)
        db.commit()
        db.refresh(website)
        
        # Create test agent
        agent = User(
            name="Test Agent",
            email="agent@test-state.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        
        # Assign agent to website
        assignment = AgentWebsiteAssignment(
            agent_id=agent.id,
            website_id=website.id
        )
        db.add(assignment)
        db.commit()
        
        print(f"  - Created website: {website.domain} (id={website.id})")
        print(f"  - Created agent: {agent.email} (id={agent.id})")
        
        # Initialize ConversationService
        conversation_service = ConversationService(db)
        
        # Test 1: Website offline → OFFLINE conversation created
        print("\n[TEST 1] Website offline → OFFLINE conversation created")
        online_before = is_website_online(website.id)
        print(f"  - Website online status: {online_before}")
        
        # Create conversation while offline (agent not connected)
        conv1 = conversation_service.get_or_create_conversation(
            website_id=website.id,
            session_id="session-offline-test-state"
        )
        
        print(f"  - Conversation created: id={conv1.id}, status={conv1.status.value}")
        assert conv1.status == ConversationStatus.OFFLINE, "Conversation should be OFFLINE when website offline"
        print("  ✓ PASS: OFFLINE conversation created")
        
        # Test 2: System message added for offline conversation
        print("\n[TEST 2] System message added for offline conversation")
        messages = db.query(Message).filter_by(conversation_id=conv1.id).all()
        system_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM]
        
        print(f"  - Total messages: {len(messages)}")
        print(f"  - System messages: {len(system_messages)}")
        
        if system_messages:
            print(f"  - System message content: {system_messages[0].content}")
        
        assert len(system_messages) > 0, "System message should be created for offline conversation"
        assert "offline" in system_messages[0].content.lower(), "System message should mention offline status"
        print("  ✓ PASS: System message created for offline conversation")
        
        # Test 3: Website online → ACTIVE conversation created
        print("\n[TEST 3] Website online → ACTIVE conversation created")
        mark_connected(agent.id)  # Connect agent
        online_after = is_website_online(website.id)
        print(f"  - Website online status: {online_after}")
        
        conv2 = conversation_service.get_or_create_conversation(
            website_id=website.id,
            session_id="session-active-test-state"
        )
        
        print(f"  - Conversation created: id={conv2.id}, status={conv2.status.value}")
        assert conv2.status == ConversationStatus.ACTIVE, "Conversation should be ACTIVE when website online"
        print("  ✓ PASS: ACTIVE conversation created")
        
        # Test 4: No system message for ACTIVE conversation
        print("\n[TEST 4] No offline system message for ACTIVE conversation")
        messages = db.query(Message).filter_by(conversation_id=conv2.id).all()
        system_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM and "offline" in m.content.lower()]
        
        print(f"  - System messages with 'offline': {len(system_messages)}")
        assert len(system_messages) == 0, "No offline system message for ACTIVE conversation"
        print("  ✓ PASS: No offline message for ACTIVE conversation")
        
        # Test 5: Visitor can add message to OFFLINE conversation
        print("\n[TEST 5] Visitor can add message to OFFLINE conversation")
        visitor_msg = conversation_service.add_visitor_message(
            conversation_id=conv1.id,
            content="Hello, is anyone there?"
        )
        
        assert visitor_msg is not None, "Visitor message should be added to OFFLINE conversation"
        assert visitor_msg.sender_type == MessageSenderType.VISITOR, "Sender type should be VISITOR"
        print(f"  - Visitor message added: id={visitor_msg.id}")
        print("  ✓ PASS: Visitor can message OFFLINE conversation")
        
        # Test 6: OFFLINE → ACTIVE transition when agent replies
        print("\n[TEST 6] OFFLINE → ACTIVE transition when agent replies")
        db.refresh(conv1)
        print(f"  - Status before agent reply: {conv1.status.value}")
        
        agent_msg = conversation_service.add_agent_message(
            conversation_id=conv1.id,
            agent_id=agent.id,
            agent_email=agent.email,
            content="Hi! I'm here to help."
        )
        
        db.refresh(conv1)
        print(f"  - Status after agent reply: {conv1.status.value}")
        assert conv1.status == ConversationStatus.ACTIVE, "Conversation should transition to ACTIVE"
        assert conv1.assigned_agent_id == agent.id, "Agent should be assigned"
        print("  ✓ PASS: OFFLINE → ACTIVE transition works")
        
        # Test 7: System message added during transition
        print("\n[TEST 7] System message added during OFFLINE → ACTIVE transition")
        messages = db.query(Message).filter_by(conversation_id=conv1.id).order_by(Message.created_at).all()
        system_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM]
        
        print(f"  - Total system messages: {len(system_messages)}")
        join_messages = [m for m in system_messages if "joined" in m.content.lower()]
        
        if join_messages:
            print(f"  - Join message: {join_messages[0].content}")
        
        assert len(join_messages) > 0, "System message about agent joining should be created"
        print("  ✓ PASS: System message created on transition")
        
        # Test 8: Close conversation (ACTIVE → CLOSED)
        print("\n[TEST 8] Close conversation (ACTIVE → CLOSED)")
        success = conversation_service.close_conversation(conv1.id)
        
        db.refresh(conv1)
        print(f"  - Close success: {success}")
        print(f"  - Status after close: {conv1.status.value}")
        
        assert success == True, "Close should succeed"
        assert conv1.status == ConversationStatus.CLOSED, "Status should be CLOSED"
        print("  ✓ PASS: Conversation closed successfully")
        
        # Test 9: System message added when closing
        print("\n[TEST 9] System message added when closing")
        messages = db.query(Message).filter_by(conversation_id=conv1.id).order_by(Message.created_at).all()
        close_messages = [m for m in messages if m.sender_type == MessageSenderType.SYSTEM and "closed" in m.content.lower()]
        
        print(f"  - Close system messages: {len(close_messages)}")
        if close_messages:
            print(f"  - Close message: {close_messages[0].content}")
        
        assert len(close_messages) > 0, "System message about closing should be created"
        print("  ✓ PASS: Close system message created")
        
        # Test 10: Cannot add visitor message to CLOSED conversation
        print("\n[TEST 10] Cannot add visitor message to CLOSED conversation")
        rejected_msg = conversation_service.add_visitor_message(
            conversation_id=conv1.id,
            content="Can you still hear me?"
        )
        
        print(f"  - Message accepted: {rejected_msg is not None}")
        assert rejected_msg is None, "Visitor message should be rejected for CLOSED conversation"
        print("  ✓ PASS: Visitor messages rejected for CLOSED conversation")
        
        # Test 11: Cannot add agent message to CLOSED conversation
        print("\n[TEST 11] Cannot add agent message to CLOSED conversation")
        rejected_agent_msg = conversation_service.add_agent_message(
            conversation_id=conv1.id,
            agent_id=agent.id,
            agent_email=agent.email,
            content="Testing closed conversation"
        )
        
        print(f"  - Agent message accepted: {rejected_agent_msg is not None}")
        assert rejected_agent_msg is None, "Agent message should be rejected for CLOSED conversation"
        print("  ✓ PASS: Agent messages rejected for CLOSED conversation")
        
        # Test 12: MessageSenderType enum values
        print("\n[TEST 12] MessageSenderType enum values")
        assert MessageSenderType.VISITOR.value == "visitor", "VISITOR value correct"
        assert MessageSenderType.AGENT.value == "agent", "AGENT value correct"
        assert MessageSenderType.SYSTEM.value == "system", "SYSTEM value correct"
        print("  ✓ PASS: MessageSenderType enum correct")
        
        # Test 13: ConversationStatus enum values
        print("\n[TEST 13] ConversationStatus enum values")
        assert ConversationStatus.ACTIVE.value == "active", "ACTIVE value correct"
        assert ConversationStatus.OFFLINE.value == "offline", "OFFLINE value correct"
        assert ConversationStatus.CLOSED.value == "closed", "CLOSED value correct"
        print("  ✓ PASS: ConversationStatus enum correct")
        
        # Test 14: can_add_message check
        print("\n[TEST 14] can_add_message check")
        can_add_active = conversation_service.can_add_message(conv2.id)
        can_add_closed = conversation_service.can_add_message(conv1.id)
        
        print(f"  - Can add to ACTIVE: {can_add_active}")
        print(f"  - Can add to CLOSED: {can_add_closed}")
        
        assert can_add_active == True, "Should be able to add to ACTIVE"
        assert can_add_closed == False, "Should NOT be able to add to CLOSED"
        print("  ✓ PASS: can_add_message works correctly")
        
        # Test 15: Getting existing conversation returns same object
        print("\n[TEST 15] Getting existing conversation returns same object")
        conv2_again = conversation_service.get_or_create_conversation(
            website_id=website.id,
            session_id="session-active-test-state"  # Same session ID
        )
        
        print(f"  - Original conv2 id: {conv2.id}")
        print(f"  - Retrieved conv2 id: {conv2_again.id}")
        
        assert conv2.id == conv2_again.id, "Should return same conversation"
        print("  ✓ PASS: Existing conversation retrieved correctly")
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        
        print("\n📋 KEY TAKEAWAYS:")
        print("  1. Conversations have explicit lifecycle states (ACTIVE, OFFLINE, CLOSED)")
        print("  2. Website online status determines initial conversation state")
        print("  3. System messages explain state changes to visitors")
        print("  4. OFFLINE → ACTIVE transition happens when agent replies")
        print("  5. CLOSED conversations reject all new messages")
        print("  6. Message sender_type (VISITOR, AGENT, SYSTEM) is explicit")
        
        print("\n⚠️  CRITICAL RULES:")
        print("  - Always use ConversationService for lifecycle management")
        print("  - Never bypass state transitions")
        print("  - System messages are mandatory for state changes")
        print("  - Check can_add_message() before adding messages")
        
        # Cleanup
        print("\n[CLEANUP] Removing test data")
        mark_disconnected(agent.id)
        db.query(Message).filter(
            Message.conversation_id.in_([conv1.id, conv2.id])
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.id.in_([conv1.id, conv2.id])).delete()
        db.query(AgentWebsiteAssignment).filter_by(website_id=website.id).delete()
        db.query(Website).filter_by(id=website.id).delete()
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
    test_conversation_state_expansion()
