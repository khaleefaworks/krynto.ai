"""Add include_in_lead flag to website_forms.

Revision ID: a4b5c6d7e8f9
Revises: 9d1c2b3a4f5e
Create Date: 2026-07-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a4b5c6d7e8f9'
down_revision = '9d1c2b3a4f5e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'website_forms',
        sa.Column('include_in_lead', sa.Boolean(), nullable=False, server_default='true'),
    )


def downgrade() -> None:
    op.drop_column('website_forms', 'include_in_lead')
