"""add_widget_config_to_websites

Revision ID: 6168d0a84d56
Revises: 7b896e76a93d
Create Date: 2025-12-26 11:54:34.035061

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6168d0a84d56'
down_revision = '7b896e76a93d'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('websites', sa.Column('widget_config', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('websites', 'widget_config')
