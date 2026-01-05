"""add_last_reset_at_to_system_settings

Revision ID: ed71c38d8e14
Revises: 24a4c1dc5ffd
Create Date: 2026-01-05 19:58:19.596010

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ed71c38d8e14'
down_revision = '24a4c1dc5ffd'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('system_settings', sa.Column('last_reset_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('system_settings', 'last_reset_at')
