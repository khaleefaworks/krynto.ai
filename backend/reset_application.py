#!/usr/bin/env python3
"""
Reset the AI ChatAssist application to fresh state.
This will delete ALL data and reset system initialization.

Use this for:
- Testing onboarding flow
- Fresh start
- Development reset

WARNING: This is DESTRUCTIVE and cannot be undone!
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

def confirm_reset():
    """Ask for confirmation before resetting"""
    print("⚠️  WARNING: This will DELETE ALL DATA from the database!")
    print("   - All users")
    print("   - All websites")
    print("   - All conversations and messages")
    print("   - System settings (will trigger onboarding)")
    print()
    response = input("Are you sure you want to continue? Type 'YES' to confirm: ")
    return response == "YES"

def reset_database():
    """Reset the database to fresh state"""
    if not confirm_reset():
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
        print("\n✅ Database reset successfully!")
        
        # Seed database with test data
        print("\n📦 Seeding database with test data...")
        seed_database()
        
        print("\n🎉 System is now ready!")
        print("\n📍 Next Steps:")
        print("   1. Navigate to http://localhost:5173 to login")
        print("   2. Widget demo: http://localhost:8080/demo.html")
        
    except Exception as e:
        print(f"\n❌ Error during reset: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    reset_database()
