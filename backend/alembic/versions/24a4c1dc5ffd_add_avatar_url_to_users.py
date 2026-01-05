"""add_avatar_url_to_users

Revision ID: 24a4c1dc5ffd
Revises: 0f0e79433345
Create Date: 2026-01-05 18:23:07.620926

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '24a4c1dc5ffd'
down_revision = '0f0e79433345'
branch_labels = None
depends_on = None


def upgrade():
    # Add avatar_url column to users table
    op.add_column('users', sa.Column('avatar_url', sa.String(500), nullable=True))


def downgrade():
    # Remove avatar_url column from users table
    op.drop_column('users', 'avatar_url')
