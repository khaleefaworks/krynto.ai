"""Seed database with initial test data"""
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
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
            print(f"ℹ️  Agent already exists: {existing_agent.email} (ID: {existing_agent.id})")
        
        # Check if website exists
        existing_website = db.query(Website).filter_by(domain="example.com").first()
        if not existing_website:
            website = Website(
                name="Example Website",
                domain="example.com",
                ai_instructions="You are a helpful assistant for Example Website."
            )
            db.add(website)
            db.commit()
            print(f"✅ Created website: {website.name} (ID: {website.id})")
        else:
            print(f"ℹ️  Website already exists: {existing_website.name} (ID: {existing_website.id})")
            
        print("\n✅ Database seeded successfully!")
        
    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
