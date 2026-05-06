"""Seed database with initial test data"""
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.website import Website
from app.models.agent_website_assignment import AgentWebsiteAssignment
from app.models.website_message_shortcut import WebsiteMessageShortcut
from app.models.system_settings import SystemSettings
from app.models.automation_template import AutomationTemplate
from app.core.security import get_password_hash


AUTOMATION_LIBRARY_TEMPLATES = [
    # ── Presence timeline ────────────────────────────────────────────────────
    {
        "name": "Visitor dropped event",
        "description": "Log a system event when the visitor leaves the page.",
        "trigger": "visitor_dropped",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_seconds": 10}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor left the page.", "event_type": "visitor_dropped", "send_to_visitor": False, "visitor_content": ""}, "position": {"x": 0, "y": 150}},
        ],
        "edges": [{"id": "e1", "from": "trigger", "to": "n1"}],
    },
    {
        "name": "Visitor reconnected",
        "description": "Log a system event when the visitor returns to the page after a disconnect.",
        "trigger": "visitor_reconnected",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"repeat": "always"}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor returned to the page.", "event_type": "visitor_reconnected", "send_to_visitor": False, "visitor_content": ""}, "position": {"x": 0, "y": 150}},
        ],
        "edges": [{"id": "e1", "from": "trigger", "to": "n1"}],
    },
    # ── During conversation ──────────────────────────────────────────────────
    {
        "name": "Waiting message",
        "description": "Reassure the visitor after 30 seconds with no agent response.",
        "trigger": "no_agent_assigned_for",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"delay_seconds": 30}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "send_bot_message", "config": {"message": "Thanks! An agent will be with you shortly.", "event_type": "bot_waiting"}, "position": {"x": 0, "y": 150}},
        ],
        "edges": [{"id": "e1", "from": "trigger", "to": "n1"}],
    },
    {
        "name": "Offline prompt",
        "description": "Inform the visitor the team is offline and invite them to leave a message.",
        "trigger": "website_offline_first_message",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 0, "y": 0}},
            {"id": "n_wait", "type": "wait", "config": {"seconds": 2}, "position": {"x": 0, "y": 150}},
            {"id": "n1", "type": "send_bot_message", "config": {"message": "Hi {visitor_name}, thanks for reaching out! We're currently offline, but we've received your message. We'll get back to you at {contact_info} as soon as possible. Feel free to leave any additional details below.", "event_type": "bot_offline"}, "position": {"x": 0, "y": 300}},
        ],
        "edges": [
            {"id": "e1", "from": "trigger", "to": "n_wait"},
            {"id": "e2", "from": "n_wait", "to": "n1"},
        ],
    },
    {
        "name": "Agent joined",
        "description": "Tag the conversation with the agent's name when they join.",
        "trigger": "agent_joined",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"repeat": "always"}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "tag_with_agent_name", "config": {}, "position": {"x": 0, "y": 150}},
        ],
        "edges": [{"id": "e1", "from": "trigger", "to": "n1"}],
    },
    # ── Visitor ended ────────────────────────────────────────────────────────
    {
        "name": "Visitor ended chat",
        "description": "Show a system event and prompt a CSAT rating when the visitor ends the chat.",
        "trigger": "conversation_visitor_ended",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"repeat": "once"}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor ended the chat.", "visitor_content": "You ended the chat.", "event_type": "visitor_ended"}, "position": {"x": 0, "y": 150}},
            {"id": "n2", "type": "show_rating_popup", "config": {"event_type": "rating_popup_shown"}, "position": {"x": 0, "y": 300}},
        ],
        "edges": [
            {"id": "e1", "from": "trigger", "to": "n1"},
            {"id": "e2", "from": "n1", "to": "n2"},
        ],
    },
    # ── Resolved ─────────────────────────────────────────────────────────────
    {
        "name": "Resolved rating",
        "description": "Notify the visitor the conversation is resolved and show a CSAT rating prompt.",
        "trigger": "conversation_resolved",
        "category": "auto_message",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {"repeat": "once"}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "emit_system_event", "config": {"content": "{agent_name} resolved the chat.", "visitor_content": "{agent_name} has resolved this conversation.", "event_type": "conversation_resolved_message"}, "position": {"x": 0, "y": 150}},
            {"id": "n2", "type": "show_rating_popup", "config": {"event_type": "rating_popup_shown"}, "position": {"x": 0, "y": 300}},
        ],
        "edges": [
            {"id": "e1", "from": "trigger", "to": "n1"},
            {"id": "e2", "from": "n1", "to": "n2"},
        ],
    },
    # ── Chatbot ───────────────────────────────────────────────────────────────
    {
        "name": "Team routing chatbot",
        "description": "Present visitors with department buttons on connect so they self-route to the right team.",
        "trigger": "conversation_created",
        "category": "chatbot_flow",
        "nodes": [
            {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "type": "bot_prompt_buttons", "config": {"message": "Welcome! What are you looking for?", "allow_input": False, "buttons": []}, "position": {"x": 0, "y": 150}},
        ],
        "edges": [{"id": "e1", "from": "trigger", "to": "n1"}],
    },
]


def seed_automation_library(db=None) -> None:
    """Insert library templates that are missing. Safe to call multiple times."""
    own_session = db is None
    if own_session:
        db = SessionLocal()
    try:
        existing_names = {
            name for (name,) in db.query(AutomationTemplate.name).all()
        }
        added = 0
        for tpl in AUTOMATION_LIBRARY_TEMPLATES:
            if tpl["name"] in existing_names:
                continue
            db.add(AutomationTemplate(
                name=tpl["name"],
                description=tpl.get("description"),
                trigger=tpl["trigger"],
                category=tpl.get("category", "auto_message"),
                nodes=tpl.get("nodes", []),
                edges=tpl.get("edges", []),
            ))
            added += 1
        if added:
            db.commit()
            print(f"✅ Seeded {added} automation library template(s)")
        else:
            print("ℹ️  Automation library templates already present")
    except Exception as e:
        print(f"❌ Error seeding automation library: {e}")
        db.rollback()
    finally:
        if own_session:
            db.close()


def seed_database():
    db = SessionLocal()
    
    try:
        # Check if system manager already exists
        existing_admin = db.query(User).filter_by(email="ragul.k@noveloffice.in").first()
        if not existing_admin:
            admin = User(
                name="Administrator",
                email="ragul.k@noveloffice.in",
                password_hash=get_password_hash("$0ft%963$"),
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
                domain="example.com",
                widget_key="f6b2115d1e3b9158ff953b71951fddd93fffae41142c74c2409f8c5f7342dca9"  # Fixed test key for demo.html
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
            existing_shortcut = db.query(WebsiteMessageShortcut).filter_by(
                website_id=website.id,
                shortcut=shortcut_data["shortcut"]
            ).first()
            
            if not existing_shortcut:
                shortcut = WebsiteMessageShortcut(
                    website_id=website.id,
                    **shortcut_data
                )
                db.add(shortcut)
                print(f"✅ Created shortcut: {shortcut_data['shortcut']}")
        
        db.commit()
            
        print("\n✅ Database seeded successfully!")
        
        # Mark system as initialized
        print("\n🔐 Marking system as initialized...")
        existing_settings = db.query(SystemSettings).first()
        if not existing_settings:
            system_settings = SystemSettings(is_initialized=True)
            db.add(system_settings)
            db.commit()
            print("✅ System marked as initialized")
        else:
            if not existing_settings.is_initialized:
                existing_settings.is_initialized = True
                db.commit()
                print("✅ System marked as initialized")
            else:
                print("ℹ️  System already initialized")
        
        # Seed automation library templates
        print("\n📚 Seeding automation library templates...")
        seed_automation_library(db)

        print("\n📋 Login Credentials:")
        print("   Admin: ragul.k@noveloffice.in / $0ft%963$")
        print("   Agent: agent@test.com / agent123")

    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
