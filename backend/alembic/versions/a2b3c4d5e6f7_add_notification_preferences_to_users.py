"""add_notification_preferences_to_users

Revision ID: a2b3c4d5e6f7
Revises: ed71c38d8e14
Create Date: 2026-04-13 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a2b3c4d5e6f7'
down_revision = ('ed71c38d8e14', 'a3f7e2c1b9d4')
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('notification_preferences', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('users', 'notification_preferences')
