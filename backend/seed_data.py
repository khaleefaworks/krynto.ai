"""Seed database with initial test data"""
from app.core.database import SessionLocal
from app.models.agent import Agent
from app.models.website import Website

def seed_database():
    db = SessionLocal()
    
    try:
        # Check if agent already exists
        existing_agent = db.query(Agent).filter_by(email="agent@test.com").first()
        if not existing_agent:
            agent = Agent(
                email="agent@test.com",
                is_active=True
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
