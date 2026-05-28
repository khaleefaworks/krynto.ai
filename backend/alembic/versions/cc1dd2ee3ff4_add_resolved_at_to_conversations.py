"""add_resolved_at_to_conversations

Revision ID: cc1dd2ee3ff4
Revises: a9b8c7d6e5f4
Create Date: 2026-05-28 00:00:00.000000

Adds a dedicated resolved_at timestamp to conversations so analytics can
correctly filter resolved conversations by the time they were actually closed,
not by updated_at which changes on any mutation (tag added, note saved, etc.).

The backfill sets resolved_at = updated_at for existing RESOLVED rows as the
best available approximation of when they were closed.
"""
from alembic import op
import sqlalchemy as sa


revision = 'cc1dd2ee3ff4'
down_revision = 'a9b8c7d6e5f4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'conversations',
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
    )
    op.execute(
        "UPDATE conversations SET resolved_at = updated_at WHERE status = 'resolved' AND resolved_at IS NULL"
    )
    op.create_index('ix_conversations_resolved_at', 'conversations', ['resolved_at'])


def downgrade():
    op.drop_index('ix_conversations_resolved_at', table_name='conversations')
    op.drop_column('conversations', 'resolved_at')
