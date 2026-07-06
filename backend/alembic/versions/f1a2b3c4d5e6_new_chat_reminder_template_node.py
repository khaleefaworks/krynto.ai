"""give new chat reminder template a real action node

Revision ID: f1a2b3c4d5e6
Revises: e6f7a8b9c0d1
Create Date: 2026-07-06 15:00:00.000000

The 'New chat reminder' template (seeded in e6f7a8b9c0d1) was trigger-only,
with the interval buried in the trigger's cooldown_seconds. Reworked so the
interval lives on a real repeat_new_chat_notification action node, consistent
with every other template.
"""
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE automation_templates
        SET nodes = '[
                {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "repeat_new_chat_notification", "config": {"interval_seconds": 15}, "position": {"x": 200, "y": 190}}
            ]'::json,
            edges = '[{"id": "e1", "from": "trigger", "to": "n1"}]'::json
        WHERE name = 'New chat reminder' AND trigger = 'new_chat_unclaimed'
    """)


def downgrade():
    op.execute("""
        UPDATE automation_templates
        SET nodes = '[
                {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_seconds": 15}, "position": {"x": 200, "y": 40}}
            ]'::json,
            edges = '[]'::json
        WHERE name = 'New chat reminder' AND trigger = 'new_chat_unclaimed'
    """)
