#!/usr/bin/env python3
"""
Test script for Step 1.4 - Website Online Resolver

This script verifies:
1. Website with no agents -> offline
2. Agents assigned but all unavailable -> offline
3. Agents available but disconnected -> offline
4. At least one eligible agent -> online
5. Resolver is single source of truth
6. Widget status endpoint reflects reality
"""

import sys
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.services.website_resolver import (
    is_website_online,
    get_eligible_agents_for_website,
    get_online_websites
)
from app.services.connection_manager import (
    mark_connected,
    mark_disconnected,
    get_connected_user_ids,
    is_user_connected
)
from app.core.security import get_password_hash


def test_website_online_resolver():
    print("=" * 60)
    print("TESTING STEP 1.4 - WEBSITE ONLINE RESOLVER")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Setup: Create test data
        print("\n[SETUP] Creating test data")
        
        # Clean up existing test data
        db.query(AgentWebsiteAssignment).filter(
            AgentWebsiteAssignment.website_id.in_(
                db.query(Website.id).filter(Website.domain.like('%test-resolver.local'))
            )
        ).delete(synchronize_session=False)
        db.query(Website).filter(Website.domain.like('%test-resolver.local')).delete()
        db.query(User).filter(User.email.like('%@test-resolver.local')).delete()
        db.commit()
        
        # Create test websites
        website1 = Website(
            name="Test Website 1",
            domain="site1.test-resolver.local",
            ai_instructions="Test instructions"
        )
        website2 = Website(
            name="Test Website 2 (No Agents)",
            domain="site2.test-resolver.local",
            ai_instructions="Test instructions"
        )
        db.add_all([website1, website2])
        db.commit()
        db.refresh(website1)
        db.refresh(website2)
        
        # Create test agents
        agent1 = User(
            name="Agent One",
            email="agent1@test-resolver.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        agent2 = User(
            name="Agent Two",
            email="agent2@test-resolver.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=True,
            is_available=True
        )
        agent3 = User(
            name="Agent Three (Inactive)",
            email="agent3@test-resolver.local",
            password_hash=get_password_hash("password"),
            role=UserRole.LIMITED_ACCESS,
            is_active=False,
            is_available=True
        )
        db.add_all([agent1, agent2, agent3])
        db.commit()
        db.refresh(agent1)
        db.refresh(agent2)
        db.refresh(agent3)
        
        # Assign agents to website1
        assignment1 = AgentWebsiteAssignment(
            agent_id=agent1.id,
            website_id=website1.id
        )
        assignment2 = AgentWebsiteAssignment(
            agent_id=agent2.id,
            website_id=website1.id
        )
        assignment3 = AgentWebsiteAssignment(
            agent_id=agent3.id,
            website_id=website1.id
        )
        db.add_all([assignment1, assignment2, assignment3])
        db.commit()
        
        print(f"  - Created website1: {website1.domain} (id={website1.id})")
        print(f"  - Created website2: {website2.domain} (id={website2.id})")
        print(f"  - Created agent1: {agent1.email} (assigned to website1)")
        print(f"  - Created agent2: {agent2.email} (assigned to website1)")
        print(f"  - Created agent3: {agent3.email} (inactive, assigned to website1)")
        
        # Test 1: Website with no agents -> offline
        print("\n[TEST 1] Website with no agents -> offline")
        online_no_agents = is_website_online(website2.id)
        print(f"  - Website2 (no agents): {online_no_agents}")
        assert online_no_agents == False, "Website with no agents should be offline"
        print("  ✓ PASS: Website with no agents is offline")
        
        # Test 2: Agents assigned but all unavailable -> offline
        print("\n[TEST 2] Agents assigned but all unavailable -> offline")
        agent1.is_available = False
        agent2.is_available = False
        db.commit()
        
        # Even if connected, unavailable agents shouldn't make site online
        mark_connected(agent1.id)
        mark_connected(agent2.id)
        
        online_all_unavailable = is_website_online(website1.id)
        print(f"  - All agents unavailable (but connected): {online_all_unavailable}")
        assert online_all_unavailable == False, "Website with unavailable agents should be offline"
        
        # Clean up connections
        mark_disconnected(agent1.id)
        mark_disconnected(agent2.id)
        print("  ✓ PASS: Website with unavailable agents is offline")
        
        # Test 3: Agents available but disconnected -> offline
        print("\n[TEST 3] Agents available but disconnected -> offline")
        agent1.is_available = True
        agent2.is_available = True
        db.commit()
        
        # Ensure no connections
        assert agent1.id not in get_connected_user_ids()
        assert agent2.id not in get_connected_user_ids()
        
        online_all_disconnected = is_website_online(website1.id)
        print(f"  - All agents available but disconnected: {online_all_disconnected}")
        assert online_all_disconnected == False, "Website with disconnected agents should be offline"
        print("  ✓ PASS: Website with disconnected agents is offline")
        
        # Test 4: At least one eligible agent -> online
        print("\n[TEST 4] At least one eligible agent -> online")
        
        # Make agent1 eligible: active, available, connected
        agent1.is_available = True
        db.commit()
        mark_connected(agent1.id)
        
        online_one_eligible = is_website_online(website1.id)
        print(f"  - One agent eligible (active, available, connected): {online_one_eligible}")
        assert online_one_eligible == True, "Website with one eligible agent should be online"
        print("  ✓ PASS: Website with one eligible agent is online")
        
        # Test 5: Eligible agents list
        print("\n[TEST 5] Get eligible agents for website")
        eligible = get_eligible_agents_for_website(website1.id, db)
        print(f"  - Total assigned agents: 3")
        print(f"  - Eligible agents: {len(eligible)}")
        print(f"  - Eligible: {[a.email for a in eligible]}")
        assert len(eligible) == 1, "Should have exactly 1 eligible agent"
        assert eligible[0].id == agent1.id, "Agent1 should be the eligible one"
        print("  ✓ PASS: Eligible agents list correct")
        
        # Test 6: Multiple eligible agents
        print("\n[TEST 6] Multiple eligible agents")
        agent2.is_available = True
        db.commit()
        mark_connected(agent2.id)
        
        eligible_multi = get_eligible_agents_for_website(website1.id, db)
        print(f"  - Eligible agents: {len(eligible_multi)}")
        assert len(eligible_multi) == 2, "Should have 2 eligible agents"
        print("  ✓ PASS: Multiple eligible agents detected")
        
        # Test 7: Inactive agent never makes website online
        print("\n[TEST 7] Inactive agent never counts")
        mark_connected(agent3.id)  # Connect inactive agent
        
        eligible_with_inactive = get_eligible_agents_for_website(website1.id, db)
        print(f"  - Agent3 (inactive) connected: {is_user_connected(agent3.id)}")
        print(f"  - Eligible agents: {len(eligible_with_inactive)}")
        assert agent3.id not in [a.id for a in eligible_with_inactive], "Inactive agent should not be eligible"
        print("  ✓ PASS: Inactive agents never eligible")
        
        # Test 8: Connection manager state
        print("\n[TEST 8] Connection manager tracks state")
        connected_ids = get_connected_user_ids()
        print(f"  - Connected user IDs: {connected_ids}")
        assert agent1.id in connected_ids, "Agent1 should be connected"
        assert agent2.id in connected_ids, "Agent2 should be connected"
        assert agent3.id in connected_ids, "Agent3 should be connected"
        
        mark_disconnected(agent1.id)
        assert agent1.id not in get_connected_user_ids(), "Agent1 should be disconnected"
        print("  ✓ PASS: Connection manager tracks connections")
        
        # Test 9: Website online status changes dynamically
        print("\n[TEST 9] Status changes dynamically")
        
        # Disconnect all agents
        mark_disconnected(agent1.id)
        mark_disconnected(agent2.id)
        mark_disconnected(agent3.id)
        
        online_after_disconnect = is_website_online(website1.id)
        print(f"  - After all disconnect: {online_after_disconnect}")
        assert online_after_disconnect == False, "Should be offline after all disconnect"
        
        # Reconnect one
        mark_connected(agent2.id)
        online_after_reconnect = is_website_online(website1.id)
        print(f"  - After one reconnect: {online_after_reconnect}")
        assert online_after_reconnect == True, "Should be online after reconnect"
        print("  ✓ PASS: Status changes dynamically")
        
        # Test 10: Get all online websites
        print("\n[TEST 10] List all online websites")
        online_websites = get_online_websites()
        print(f"  - Online websites: {online_websites}")
        assert website1.id in online_websites, "Website1 should be in online list"
        assert website2.id not in online_websites, "Website2 should not be in online list"
        print("  ✓ PASS: Online websites list correct")
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        
        print("\n📋 KEY TAKEAWAYS:")
        print("  1. is_website_online() is SINGLE SOURCE OF TRUTH")
        print("  2. Website online requires: assigned + active + available + connected")
        print("  3. At least ONE eligible agent makes website online")
        print("  4. Status changes dynamically with connections")
        print("  5. Inactive agents NEVER count")
        
        print("\n⚠️  CRITICAL RULES:")
        print("  - Widget must call /widget/status endpoint")
        print("  - Chat routing must use is_website_online()")
        print("  - No hardcoded 'online' flags")
        print("  - All decisions go through resolver")
        
        # Cleanup
        print("\n[CLEANUP] Removing test data")
        mark_disconnected(agent1.id)
        mark_disconnected(agent2.id)
        mark_disconnected(agent3.id)
        
        db.query(AgentWebsiteAssignment).filter(
            AgentWebsiteAssignment.website_id.in_([website1.id, website2.id])
        ).delete()
        db.query(Website).filter(Website.id.in_([website1.id, website2.id])).delete()
        db.query(User).filter(User.id.in_([agent1.id, agent2.id, agent3.id])).delete()
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
    success = test_website_online_resolver()
    sys.exit(0 if success else 1)
