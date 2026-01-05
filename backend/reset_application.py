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
        
        # Create demo website for widget testing with ID=1
        print("\n📦 Creating demo website...")
        demo_website = Website(
            id=1,  # Explicitly set ID to 1 for demo consistency
            name="Demo Website",
            domain="demo.local",
            widget_config={
                "theme": "dark",
                "position": "bottom-right",
                "primaryColor": "#000000"
            }
        )
        db.add(demo_website)
        db.commit()
        
        # Reset the sequence for the websites table
        from sqlalchemy import text
        db.execute(text("SELECT setval('websites_id_seq', (SELECT MAX(id) FROM websites));"))
        db.commit()
        
        db.refresh(demo_website)
        
        print(f"   ✅ Demo website created with ID: {demo_website.id}")
        print(f"   - Name: {demo_website.name}")
        print(f"   - Domain: {demo_website.domain}")
        
        print("\n🎉 System is now in fresh state.")
        print("\n📍 Next Steps:")
        print("   1. Navigate to http://localhost:5173 to see the onboarding screen")
        print(f"   2. Widget demo: http://localhost:8080/demo.html")
        print(f"      → Refresh the page if already open to reconnect to website_id={demo_website.id}")
        
    except Exception as e:
        print(f"\n❌ Error during reset: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    reset_database()
