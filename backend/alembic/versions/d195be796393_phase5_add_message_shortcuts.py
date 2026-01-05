"""phase5_add_message_shortcuts

Revision ID: d195be796393
Revises: 559329089297
Create Date: 2026-01-05 15:33:33.833853

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd195be796393'
down_revision = '559329089297'
branch_labels = None
depends_on = None


def upgrade():
    # Create message_shortcuts table
    op.create_table(
        'message_shortcuts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('shortcut', sa.String(50), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('website_id', 'shortcut', name='uq_website_shortcut')
    )
    
    # Add index for faster lookups
    op.create_index('ix_message_shortcuts_website_id', 'message_shortcuts', ['website_id'])


def downgrade():
    op.drop_index('ix_message_shortcuts_website_id', table_name='message_shortcuts')
    op.drop_table('message_shortcuts')
