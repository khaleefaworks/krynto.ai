"""add automation_templates table and template_id on automations

Revision ID: b3c2d1e0f9a8
Revises: 69e33c2d22b2
Create Date: 2026-04-29 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b3c2d1e0f9a8'
down_revision = '69e33c2d22b2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'automation_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('trigger', sa.String(100), nullable=False),
        sa.Column('category', sa.String(50), nullable=False, server_default='auto_message'),
        sa.Column('nodes', sa.JSON(), nullable=True),
        sa.Column('edges', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_automation_templates_trigger', 'automation_templates', ['trigger'])

    op.add_column('automations', sa.Column('template_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_automations_template_id',
        'automations', 'automation_templates',
        ['template_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_automations_template_id', 'automations', ['template_id'])

    # Seed the welcome template
    op.execute("""
        INSERT INTO automation_templates (name, description, trigger, category, nodes, edges, created_at)
        VALUES (
            'Welcome message',
            'Sends a friendly greeting when a visitor opens the widget. Includes a 24-hour cooldown so returning visitors are not greeted repeatedly.',
            'visitor_connected',
            'auto_message',
            '[
                {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_hours": 24, "delay_seconds": 3}, "position": {"x": 200, "y": 40}},
                {"id": "n1", "type": "send_bot_message", "config": {"message": "Hi! How can we help you today?", "event_type": "automation_welcome"}, "position": {"x": 200, "y": 190}}
            ]'::json,
            '[{"id": "e1", "from": "trigger", "to": "n1"}]'::json,
            now()
        )
    """)


def downgrade():
    op.drop_index('ix_automations_template_id', 'automations')
    op.drop_constraint('fk_automations_template_id', 'automations', type_='foreignkey')
    op.drop_column('automations', 'template_id')
    op.drop_index('ix_automation_templates_trigger', 'automation_templates')
    op.drop_table('automation_templates')
