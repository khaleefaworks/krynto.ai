"""add visitor_ended to conversations

Revision ID: e6f5a4b3c2d1
Revises: d5e4f3c2b1a0
Create Date: 2026-04-30 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'e6f5a4b3c2d1'
down_revision = 'd5e4f3c2b1a0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'conversations',
        sa.Column('visitor_ended', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_index('ix_conversations_visitor_ended', 'conversations', ['visitor_ended'])


def downgrade():
    op.drop_index('ix_conversations_visitor_ended', 'conversations')
    op.drop_column('conversations', 'visitor_ended')
