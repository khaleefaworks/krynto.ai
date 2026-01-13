"""add_system_settings_for_initialization

Revision ID: aa58c499cc2a
Revises: 405a86696b1b
Create Date: 2025-12-29 13:08:57.538109

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'aa58c499cc2a'
down_revision = '405a86696b1b'
branch_labels = None
depends_on = None


def upgrade():
    # Create system_settings table
    op.execute("""
        CREATE TABLE system_settings (
            id SERIAL PRIMARY KEY,
            is_initialized BOOLEAN NOT NULL DEFAULT false
        );
    """)


def downgrade():
    # Drop system_settings table
    op.drop_table('system_settings')
