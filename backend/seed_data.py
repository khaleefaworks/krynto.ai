"""Seed database with initial test data"""
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.message_shortcut import MessageShortcut
from app.core.security import get_password_hash

def seed_database():
    db = SessionLocal()
    
    try:
        # Check if system manager already exists
        existing_admin = db.query(User).filter_by(email="admin@chatassist.local").first()
        if not existing_admin:
            admin = User(
                name="System Administrator",
                email="admin@chatassist.local",
                password_hash=get_password_hash("admin123"),
                role=UserRole.SYSTEM_MANAGER,
                is_active=True,
                is_available=True
            )
            db.add(admin)
            db.commit()
            print(f"✅ Created admin: {admin.email} (ID: {admin.id})")
        else:
            admin = existing_admin
            print(f"ℹ️  Admin already exists: {existing_admin.email} (ID: {existing_admin.id})")
        
        # Check if test agent exists
        existing_agent = db.query(User).filter_by(email="agent@test.com").first()
        if not existing_agent:
            agent = User(
                name="Test Agent",
                email="agent@test.com",
                password_hash=get_password_hash("agent123"),
                role=UserRole.AGENT,
                is_active=True,
                is_available=True
            )
            db.add(agent)
            db.commit()
            print(f"✅ Created agent: {agent.email} (ID: {agent.id})")
        else:
            agent = existing_agent
            print(f"ℹ️  Agent already exists: {existing_agent.email} (ID: {existing_agent.id})")
        
        # Check if website exists
        existing_website = db.query(Website).filter_by(domain="example.com").first()
        if not existing_website:
            website = Website(
                name="Example Website",
                domain="example.com"
            )
            db.add(website)
            db.commit()
            db.refresh(website)
            print(f"✅ Created website: {website.name} (ID: {website.id}, widget_key: {website.widget_key})")
        else:
            website = existing_website
            print(f"ℹ️  Website already exists: {existing_website.name} (ID: {existing_website.id})")
        
        # Assign agent to website
        existing_assignment = db.query(AgentWebsiteAssignment).filter_by(
            agent_id=agent.id,
            website_id=website.id
        ).first()
        if not existing_assignment:
            assignment = AgentWebsiteAssignment(
                agent_id=agent.id,
                website_id=website.id
            )
            db.add(assignment)
            db.commit()
            print(f"✅ Assigned agent {agent.name} to website {website.name}")
        else:
            print(f"ℹ️  Agent assignment already exists")
        
        # Create sample message shortcuts
        shortcuts_data = [
            {"shortcut": "/hello", "message": "Hello! How can I help you today?"},
            {"shortcut": "/thanks", "message": "Thank you for contacting us! Have a great day!"},
            {"shortcut": "/wait", "message": "Please wait a moment while I check that for you."},
        ]
        
        for shortcut_data in shortcuts_data:
            existing_shortcut = db.query(MessageShortcut).filter_by(
                website_id=website.id,
                shortcut=shortcut_data["shortcut"]
            ).first()
            
            if not existing_shortcut:
                shortcut = MessageShortcut(
                    website_id=website.id,
                    **shortcut_data
                )
                db.add(shortcut)
                print(f"✅ Created shortcut: {shortcut_data['shortcut']}")
        
        db.commit()
            
        print("\n✅ Database seeded successfully!")
        print("\n📋 Login Credentials:")
        print("   Admin: admin@chatassist.local / admin123")
        print("   Agent: agent@test.com / agent123")
        
    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
