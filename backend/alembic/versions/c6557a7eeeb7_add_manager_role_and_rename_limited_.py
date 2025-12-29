"""add_manager_role_and_rename_limited_access

Revision ID: c6557a7eeeb7
Revises: ab993fa219ef
Create Date: 2025-12-29 18:23:45.622985

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c6557a7eeeb7'
down_revision = 'ab993fa219ef'
branch_labels = None
depends_on = None


def upgrade():
    # Add new 'manager' role to enum
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'")
    
    # Add new 'agent' role to enum  
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent'")
    
    # Rename existing 'limited_access' role to 'agent'
    op.execute("UPDATE users SET role = 'agent' WHERE role = 'limited_access'")


def downgrade():
    # Revert 'agent' back to 'limited_access'
    op.execute("UPDATE users SET role = 'limited_access' WHERE role = 'agent'")
    
    # Note: PostgreSQL doesn't support removing enum values easily
    # Manual intervention required to remove 'manager' and 'agent' from enum
