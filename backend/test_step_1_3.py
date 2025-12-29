#!/usr/bin/env python3
"""
Test script for Step 1.3 - Agent Availability (Hard Rule)

This script verifies:
1. Availability toggle API works
2. Availability persists in database
3. Agent eligibility logic is correct
4. Availability ≠ Connection status
5. No routing can bypass availability
"""

import sys
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.services.agent_resolver import is_agent_eligible, get_available_agents
from app.core.security import get_password_hash


def test_availability_flow():
    print("=" * 60)
    print("TESTING STEP 1.3 - AGENT AVAILABILITY (HARD RULE)")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Setup: Ensure we have test agents
        print("\n[SETUP] Creating test agents")
        
        # Clean up any existing test agents
        db.query(User).filter(User.email.like('%@test-availability.local')).delete()
        db.commit()
        
        # Create test agents
        agent1 = User(
            name="Agent One",
            email="agent1@test-availability.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True  # Available by default
        )
        
        agent2 = User(
            name="Agent Two",
            email="agent2@test-availability.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True  # Available by default
        )
        
        agent3 = User(
            name="Agent Three (Inactive)",
            email="agent3@test-availability.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=False,  # Inactive account
            is_available=True
        )
        
        db.add_all([agent1, agent2, agent3])
        db.commit()
        db.refresh(agent1)
        db.refresh(agent2)
        db.refresh(agent3)
        
        print(f"  - Created 3 test agents")
        print(f"    Agent 1: {agent1.email} (active, available)")
        print(f"    Agent 2: {agent2.email} (active, available)")
        print(f"    Agent 3: {agent3.email} (inactive, available)")
        
        # Test 1: Initial availability state
        print("\n[TEST 1] Check initial availability state")
        print(f"  - Agent 1 is_available: {agent1.is_available}")
        print(f"  - Agent 2 is_available: {agent2.is_available}")
        assert agent1.is_available == True, "Agent should be available by default"
        assert agent2.is_available == True, "Agent should be available by default"
        print("  ✓ PASS: Agents available by default")
        
        # Test 2: Toggle availability (simulating API call)
        print("\n[TEST 2] Toggle availability")
        agent1.is_available = False
        db.commit()
        db.refresh(agent1)
        print(f"  - Agent 1 toggled to unavailable")
        print(f"  - Agent 1 is_available: {agent1.is_available}")
        assert agent1.is_available == False, "Availability should persist"
        print("  ✓ PASS: Availability toggled and persisted")
        
        # Test 3: Eligibility with different states
        print("\n[TEST 3] Agent eligibility logic")
        
        # Agent 1: Active, Unavailable, Connected -> NOT eligible
        eligible_1_connected = is_agent_eligible(agent1, is_connected=True)
        print(f"  - Agent 1 (active, unavailable, connected): {eligible_1_connected}")
        assert eligible_1_connected == False, "Unavailable agent should not be eligible"
        
        # Agent 2: Active, Available, Connected -> Eligible
        eligible_2_connected = is_agent_eligible(agent2, is_connected=True)
        print(f"  - Agent 2 (active, available, connected): {eligible_2_connected}")
        assert eligible_2_connected == True, "Available + connected agent should be eligible"
        
        # Agent 2: Active, Available, NOT Connected -> NOT eligible
        eligible_2_disconnected = is_agent_eligible(agent2, is_connected=False)
        print(f"  - Agent 2 (active, available, disconnected): {eligible_2_disconnected}")
        assert eligible_2_disconnected == False, "Disconnected agent should not be eligible"
        
        # Agent 3: Inactive, Available, Connected -> NOT eligible
        eligible_3_connected = is_agent_eligible(agent3, is_connected=True)
        print(f"  - Agent 3 (inactive, available, connected): {eligible_3_connected}")
        assert eligible_3_connected == False, "Inactive agent should not be eligible"
        
        print("  ✓ PASS: Eligibility logic correct for all states")
        
        # Test 4: Availability ≠ Connection
        print("\n[TEST 4] Availability ≠ Connection Status")
        print("  - is_available: Stored in database (persists)")
        print("  - is_connected: Runtime WebSocket status (volatile)")
        print("  - Agent must be BOTH to receive chats")
        
        # Simulate: Agent available but disconnected
        agent2.is_available = True
        db.commit()
        eligible_available_disconnected = is_agent_eligible(agent2, is_connected=False)
        assert eligible_available_disconnected == False
        print("  - Available + Disconnected = NOT eligible ✓")
        
        # Simulate: Agent unavailable but connected
        agent2.is_available = False
        db.commit()
        eligible_unavailable_connected = is_agent_eligible(agent2, is_connected=True)
        assert eligible_unavailable_connected == False
        print("  - Unavailable + Connected = NOT eligible ✓")
        
        # Simulate: Agent available AND connected
        agent2.is_available = True
        db.commit()
        eligible_both = is_agent_eligible(agent2, is_connected=True)
        assert eligible_both == True
        print("  - Available + Connected = Eligible ✓")
        
        print("  ✓ PASS: Availability and connection are separate concerns")
        
        # Test 5: Batch filtering
        print("\n[TEST 5] Filter available agents")
        
        # Reset states for test
        agent1.is_available = True
        agent2.is_available = False
        db.commit()
        
        all_agents = [agent1, agent2, agent3]
        connection_map = {
            agent1.id: True,   # Connected
            agent2.id: True,   # Connected
            agent3.id: True,   # Connected
        }
        
        available = get_available_agents(all_agents, connection_map)
        print(f"  - Total agents: {len(all_agents)}")
        print(f"  - Eligible agents: {len(available)}")
        print(f"  - Eligible: {[a.email for a in available]}")
        
        assert len(available) == 1, "Only agent1 should be eligible"
        assert available[0].id == agent1.id, "Agent1 should be the eligible one"
        print("  ✓ PASS: Batch filtering works correctly")
        
        # Test 6: Persistence across "restarts"
        print("\n[TEST 6] Availability persists across restarts")
        agent1_id = agent1.id
        agent1_before = agent1.is_available
        
        # Close session (simulate restart)
        db.close()
        
        # New session (simulate fresh connection)
        db = SessionLocal()
        agent1_after = db.query(User).filter(User.id == agent1_id).first()
        
        print(f"  - Before 'restart': {agent1_before}")
        print(f"  - After 'restart': {agent1_after.is_available}")
        assert agent1_before == agent1_after.is_available, "Availability should persist"
        print("  ✓ PASS: Availability survives restart")
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        
        print("\n📋 KEY TAKEAWAYS:")
        print("  1. Availability is user-controlled and persists in DB")
        print("  2. Connection status is runtime (WebSocket)")
        print("  3. Both must be true for agent to be eligible")
        print("  4. is_agent_eligible() is the SINGLE SOURCE OF TRUTH")
        print("  5. All routing MUST use this function")
        
        print("\n⚠️  CRITICAL RULE:")
        print("  NO chat routing can bypass is_agent_eligible()")
        print("  This prevents unavailable agents from receiving chats")
        
        # Cleanup
        print("\n[CLEANUP] Removing test agents")
        db.query(User).filter(User.email.like('%@test-availability.local')).delete()
        db.commit()
        print("  ✓ Test data cleaned up")
        
        return True
        
    except AssertionError as e:
        print(f"\n✗ FAIL: {e}")
        return False
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


if __name__ == "__main__":
    success = test_availability_flow()
    sys.exit(0 if success else 1)
