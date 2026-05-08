"""Add lockout fields to User

Revision ID: b2c3d4e5f6a7
Revises: a2b3c4d5e6f7
Create Date: 2026-04-28 04:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add fields
    op.add_column('users', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('temp_lockout_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('is_locked_out', sa.Boolean(), nullable=False, server_default='false'))

def downgrade() -> None:
    # Drop fields
    op.drop_column('users', 'is_locked_out')
    op.drop_column('users', 'temp_lockout_until')
    op.drop_column('users', 'failed_login_attempts')
