"""milestone_3_add_website_ai_enabled_flag

Revision ID: ab993fa219ef
Revises: 46963d838181
Create Date: 2025-12-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ab993fa219ef'
down_revision = '46963d838181'
branch_labels = None
depends_on = None


def upgrade():
    """
    Add ai_enabled flag to websites table.
    
    This flag determines whether AI is enabled for a specific website.
    Default is False - AI must be explicitly enabled per website.
    
    This is a Milestone 3 data-only change - the flag exists but
    is not yet used in routing logic.
    """
    op.add_column(
        'websites',
        sa.Column(
            'ai_enabled',
            sa.Boolean(),
            nullable=False,
            server_default='false'
        )
    )


def downgrade():
    """Remove ai_enabled flag from websites table."""
    op.drop_column('websites', 'ai_enabled')
