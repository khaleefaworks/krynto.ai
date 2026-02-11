"""seed_welcome_automation

Revision ID: 2f3e4d5c6b7a
Revises: 1a2b3c4d5e6f
Create Date: 2026-02-11 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
import json


# revision identifiers, used by Alembic.
revision = "2f3e4d5c6b7a"
down_revision = "1a2b3c4d5e6f"
branch_labels = None
depends_on = None


def _to_dict(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def upgrade():
    connection = op.get_bind()

    rows = connection.execute(sa.text("SELECT id, widget_config FROM websites")).fetchall()
    for row in rows:
        website_id = int(row[0])
        widget_config = _to_dict(row[1])
        automations_cfg = widget_config.get("automations")
        automations_cfg = automations_cfg if isinstance(automations_cfg, dict) else {}

        existing = connection.execute(
            sa.text(
                "SELECT COUNT(1) FROM automations WHERE website_id = :website_id AND trigger = :trigger"
            ),
            {"website_id": website_id, "trigger": "visitor_connected"},
        ).scalar()

        if existing and int(existing) > 0:
            continue

        welcome_enabled = automations_cfg.get("welcome_enabled")
        if welcome_enabled is None:
            welcome_enabled = True

        welcome_message = automations_cfg.get("welcome_message")
        if not (isinstance(welcome_message, str) and welcome_message.strip()):
            legacy = widget_config.get("welcome_message")
            if isinstance(legacy, str) and legacy.strip():
                welcome_message = legacy
            else:
                welcome_message = "Hi! How can we help you today?"

        cooldown_hours = automations_cfg.get("welcome_cooldown_hours")
        try:
            cooldown_hours = int(cooldown_hours) if cooldown_hours is not None else 24
        except Exception:
            cooldown_hours = 24
        cooldown_hours = max(1, cooldown_hours)

        payload = {
            "name": "Welcome message",
            "trigger": "visitor_connected",
            "enabled": bool(welcome_enabled),
            "conditions": {"cooldown_hours": cooldown_hours},
            "actions": [
                {
                    "type": "send_bot_message",
                    "message": str(welcome_message).strip(),
                    # Keep stable for idempotency and message lookup.
                    "event_type": "automation_welcome",
                }
            ],
        }

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
    # Do not delete user-edited automations.
    pass
