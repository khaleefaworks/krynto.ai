"""add_is_agent_only_to_messages

Revision ID: 909696409db9
Revises: e6f5a4b3c2d1
Create Date: 2026-05-06 10:25:28.506991

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '909696409db9'
down_revision = 'e6f5a4b3c2d1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('messages', sa.Column('is_agent_only', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('messages', 'is_agent_only')
