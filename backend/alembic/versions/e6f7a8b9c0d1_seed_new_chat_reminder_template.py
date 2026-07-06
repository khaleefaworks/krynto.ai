"""seed new chat reminder automation template

Revision ID: e6f7a8b9c0d1
Revises: b2c3d4e5f6a1
Create Date: 2026-07-06 14:30:00.000000

"""
from alembic import op

revision = 'e6f7a8b9c0d1'
down_revision = 'b2c3d4e5f6a1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO automation_templates (name, description, trigger, category, nodes, edges, created_at)
        VALUES
        (
            'New chat reminder',
            'Config-only automation with no action nodes: repeats the new-chat sound/push notification every cooldown_seconds while the chat sits unclaimed. Disable it to go back to a single one-shot notification.',
            'new_chat_unclaimed',
            'auto_message',
            '[
                {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_seconds": 15}, "position": {"x": 200, "y": 40}}
            ]'::json,
            '[]'::json,
            now()
        )
    """)


def downgrade():
    op.execute("""
        DELETE FROM automation_templates
        WHERE name = 'New chat reminder' AND trigger = 'new_chat_unclaimed'
    """)
