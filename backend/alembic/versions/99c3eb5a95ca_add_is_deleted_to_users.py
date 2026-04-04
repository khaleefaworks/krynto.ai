"""add_is_deleted_to_users

Revision ID: 99c3eb5a95ca
Revises: c75c064b06f5
Create Date: 2026-03-23 11:02:19.804030

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '99c3eb5a95ca'
down_revision = 'c75c064b06f5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade():
    op.drop_column('users', 'is_deleted')
