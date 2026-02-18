"""seed_default_automations

Revision ID: 1a2b3c4d5e6f
Revises: 8c1a2f9f2a0b
Create Date: 2026-01-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import json


# revision identifiers, used by Alembic.
revision = "1a2b3c4d5e6f"
down_revision = "8c1a2f9f2a0b"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()

    website_rows = connection.execute(sa.text("SELECT id FROM websites")).fetchall()
    for row in website_rows:
        website_id = int(row[0])

        existing = connection.execute(
            sa.text("SELECT COUNT(1) FROM automations WHERE website_id = :website_id"),
            {"website_id": website_id},
        ).scalar()

        if existing and int(existing) > 0:
            continue

        defaults = [
            {
                "name": "Waiting message",
                "trigger": "no_agent_assigned_for",
                "enabled": True,
                "conditions": {"delay_seconds": 60},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Thanks! An agent will be with you shortly.",
                        "event_type": "bot_waiting",
                    }
                ],
            },
            {
                "name": "Offline prompt",
                "trigger": "website_offline_first_message",
                "enabled": True,
                "conditions": {},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "We're busy at the moment. Sorry about that. Leave us your email, and we will contact you as soon as possible.",
                        "event_type": "bot_offline",
                    }
                ],
            },
            {
                "name": "Closing message",
                "trigger": "conversation_resolved",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Thanks! This conversation is now closed.",
                        "event_type": "bot_closing",
                    }
                ],
            },
        ]

        for payload in defaults:
            connection.execute(
                sa.text(
                    """
                    INSERT INTO automations (website_id, name, trigger, enabled, conditions, actions, created_at)
                    VALUES (:website_id, :name, :trigger, :enabled, :conditions, :actions, CURRENT_TIMESTAMP)
                    """
                ),
                {
                    "website_id": website_id,
                    "name": payload["name"],
                    "trigger": payload["trigger"],
                    "enabled": payload["enabled"],
                    "conditions": json.dumps(payload["conditions"]),
                    "actions": json.dumps(payload["actions"]),
                },
            )


def downgrade():
    # No-op: leave seeded records intact
    pass
