#!/usr/bin/env python3
"""
Reset the AI ChatAssist application to fresh state.
This will delete ALL data and reset system initialization.

Use this for:
- Testing onboarding flow
- Fresh start
- Development reset

WARNING: This is DESTRUCTIVE and cannot be undone!

Usage:
  python reset_application.py          # Fresh reset (onboarding flow)
  python reset_application.py --seed   # Reset with test data
"""

import sys
from app.core.database import SessionLocal, engine
from app.models.base import Base
from app.models.user import User
from app.models.website import Website
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.system_settings import SystemSettings
from app.models.agent_website_assignment import AgentWebsiteAssignment
from seed_data import seed_database

def confirm_reset(with_seed):
    """Ask for confirmation before resetting"""
    print("⚠️  WARNING: This will DELETE ALL DATA from the database!")
    print("   - All users")
    print("   - All websites")
    print("   - All conversations and messages")
    if with_seed:
        print("   - Will seed with test data (admin + agent)")
    else:
        print("   - Fresh start (will trigger onboarding)")
    print()
    response = input("Are you sure you want to continue? Type 'YES' to confirm: ")
    return response == "YES"

def reset_database(with_seed=False):
    """Reset the database to fresh state"""
    if not confirm_reset(with_seed):
        print("❌ Reset cancelled.")
        return
    
    print("\n🔄 Resetting database...")
    
    db = SessionLocal()
    try:
        # Delete all data in reverse order (respecting foreign keys)
        print("  Deleting messages...")
        db.query(Message).delete()
        
        print("  Deleting conversations...")
        db.query(Conversation).delete()
        
        print("  Deleting agent assignments...")
        db.query(AgentWebsiteAssignment).delete()
        
        print("  Deleting websites...")
        db.query(Website).delete()
        
        print("  Deleting users...")
        db.query(User).delete()
        
        print("  Resetting system settings...")
        db.query(SystemSettings).delete()
        
        db.commit()
        
        # Reset all sequences to start from 1
        print("  Resetting ID sequences...")
        from sqlalchemy import text
        db.execute(text("ALTER SEQUENCE users_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE websites_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE conversations_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE messages_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE agent_sessions_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE agent_website_assignments_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE message_shortcuts_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE conversation_tags_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE conversation_notes_id_seq RESTART WITH 1"))
        db.execute(text("ALTER SEQUENCE system_settings_id_seq RESTART WITH 1"))
        db.commit()
        
        print("\n✅ Database reset successfully!")
        
        if with_seed:
            # Seed database with test data
            print("\n📦 Seeding database with test data...")
            seed_database()
            
            # Set reset timestamp to invalidate old tokens
            from datetime import datetime, timezone
            settings = db.query(SystemSettings).first()
            if settings:
                settings.last_reset_at = datetime.now(timezone.utc)
                db.commit()
                print("\n🔐 All previous auth tokens invalidated")
            
            print("\n🎉 System is now ready!")
            print("\n📍 Next Steps:")
            print("   1. Navigate to http://localhost:5173 to login")
            print("   2. Widget demo: http://localhost:8080/demo.html")
        else:
            print("\n🎉 Fresh database created!")
            print("\n📍 Next Steps:")
            print("   1. Navigate to http://localhost:5173")
            print("   2. Complete the onboarding process")
            print("   3. Create your admin account and first website")
        
    except Exception as e:
        print(f"\n❌ Error during reset: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    # Check for --seed argument
    with_seed = "--seed" in sys.argv
    reset_database(with_seed=with_seed)
