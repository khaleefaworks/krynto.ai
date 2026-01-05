"""phase3_add_widget_key_to_websites

Revision ID: 559329089297
Revises: 7c9b5aea63de
Create Date: 2026-01-05 15:13:02.711166

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '559329089297'
down_revision = '7c9b5aea63de'
branch_labels = None
depends_on = None


def upgrade():
    # Add widget_key column (nullable first, then populate, then make non-nullable)
    op.add_column('websites', sa.Column('widget_key', sa.String(length=64), nullable=True))
    
    # Generate unique keys for existing websites
    op.execute("""
        UPDATE websites 
        SET widget_key = md5(random()::text || clock_timestamp()::text)
        WHERE widget_key IS NULL
    """)
    
    # Make widget_key non-nullable and unique
    op.alter_column('websites', 'widget_key', nullable=False)
    op.create_unique_constraint('uq_websites_widget_key', 'websites', ['widget_key'])
    op.create_index('ix_websites_widget_key', 'websites', ['widget_key'])


def downgrade():
    op.drop_index('ix_websites_widget_key', 'websites')
    op.drop_constraint('uq_websites_widget_key', 'websites', type_='unique')
    op.drop_column('websites', 'widget_key')
