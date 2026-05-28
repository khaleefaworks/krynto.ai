"""add_bot_only_to_conversations

Revision ID: a9b8c7d6e5f4
Revises: f0a1b2c3d4e5
Create Date: 2026-05-27 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a9b8c7d6e5f4'
down_revision = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'conversations',
        sa.Column('bot_only', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('conversations', 'bot_only')
