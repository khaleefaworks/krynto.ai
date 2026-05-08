"""seed additional automation templates

Revision ID: d5e4f3c2b1a0
Revises: c8a444544c30
Create Date: 2026-04-30 12:00:00.000000

"""
from alembic import op

revision = 'd5e4f3c2b1a0'
down_revision = 'c8a444544c30'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO automation_templates (name, description, trigger, category, nodes, edges, created_at)
        VALUES
        (
            'Team routing chatbot',
            'Greets new visitors with a bot prompt and routes them to the right team based on their selection. Edit the button labels and assign team IDs to match your setup.',
            'conversation_created',
            'chatbot_flow',
            '[
                {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "bot_prompt_buttons", "config": {
                    "message": "Hi! What can we help you with today?",
                    "allow_input": false,
                    "buttons": [
                        {"label": "Sales", "team_id": null, "reply": "Great! Connecting you to our Sales team."},
                        {"label": "Support", "team_id": null, "reply": "Sure! Connecting you to our Support team."},
                        {"label": "Billing", "team_id": null, "reply": "Got it! Connecting you to our Billing team."}
                    ]
                }, "position": {"x": 200, "y": 190}}
            ]'::json,
            '[{"id": "e1", "from": "trigger", "to": "n1"}]'::json,
            now()
        ),
        (
            'Offline contact capture',
            'When all agents are offline and a visitor sends their first message, greets them and asks for contact details so the team can follow up later.',
            'website_offline_first_message',
            'auto_message',
            '[
                {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "send_bot_message", "config": {
                    "message": "We''re offline right now but your message is important to us. Please leave your name and phone number and we''ll get back to you shortly.",
                    "event_type": "bot_offline"
                }, "position": {"x": 200, "y": 190}}
            ]'::json,
            '[{"id": "e1", "from": "trigger", "to": "n1"}]'::json,
            now()
        ),
        (
            'Waiting message',
            'Sends an automated message after 30 seconds if no agent has joined the conversation, so the visitor knows their message was received.',
            'no_agent_assigned_for',
            'auto_message',
            '[
                {"id": "trigger", "type": "trigger", "config": {"delay_seconds": 30}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "send_bot_message", "config": {
                    "message": "Thanks for reaching out! An agent will be with you shortly.",
                    "event_type": "bot_waiting"
                }, "position": {"x": 200, "y": 190}}
            ]'::json,
            '[{"id": "e1", "from": "trigger", "to": "n1"}]'::json,
            now()
        ),
        (
            'CSAT on resolve',
            'When a conversation is resolved, notifies the visitor and shows a satisfaction rating prompt so you can collect feedback after each chat.',
            'conversation_resolved',
            'auto_message',
            '[
                {"id": "trigger", "type": "trigger", "config": {"repeat": "once"}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "emit_system_event", "config": {
                    "content": "{agent_name} resolved the chat.",
                    "visitor_content": "{agent_name} has resolved this conversation.",
                    "event_type": "conversation_resolved_message"
                }, "position": {"x": 200, "y": 190}},
                {"id": "n2", "type": "show_rating_popup", "config": {"event_type": "rating_popup_shown"}, "position": {"x": 200, "y": 340}}
            ]'::json,
            '[{"id": "e1", "from": "trigger", "to": "n1"}, {"id": "e2", "from": "n1", "to": "n2"}]'::json,
            now()
        )
    """)


def downgrade():
    op.execute("""
        DELETE FROM automation_templates
        WHERE name IN (
            'Team routing chatbot',
            'Offline contact capture',
            'Waiting message',
            'CSAT on resolve'
        )
    """)
