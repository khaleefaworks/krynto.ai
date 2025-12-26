"""add_agent_website_assignment

Revision ID: cb96bda2a9b9
Revises: e06f52023418
Create Date: 2025-12-26 14:01:51.100627

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cb96bda2a9b9'
down_revision = 'e06f52023418'
branch_labels = None
depends_on = None


def upgrade():
    # Create agent_website_assignments table
    op.create_table(
        'agent_website_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('agent_id', 'website_id', name='uq_agent_website')
    )
    op.create_index(
        'ix_agent_website_assignments_agent_id',
        'agent_website_assignments',
        ['agent_id']
    )
    op.create_index(
        'ix_agent_website_assignments_website_id',
        'agent_website_assignments',
        ['website_id']
    )


def downgrade():
    op.drop_index('ix_agent_website_assignments_website_id', table_name='agent_website_assignments')
    op.drop_index('ix_agent_website_assignments_agent_id', table_name='agent_website_assignments')
    op.drop_table('agent_website_assignments')
