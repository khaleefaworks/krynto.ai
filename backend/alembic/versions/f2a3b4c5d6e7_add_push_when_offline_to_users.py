"""add_push_when_offline_to_users

Revision ID: f2a3b4c5d6e7
Revises: e7f8a9b0c1d2
Create Date: 2026-05-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'f2a3b4c5d6e7'
down_revision = 'e7f8a9b0c1d2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column(
            'push_when_offline',
            sa.Boolean(),
            nullable=False,
            server_default='true',
        ),
    )


def downgrade():
    op.drop_column('users', 'push_when_offline')
