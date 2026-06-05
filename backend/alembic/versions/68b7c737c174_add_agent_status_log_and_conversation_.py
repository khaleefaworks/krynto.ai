"""add_agent_status_log_and_conversation_availability_columns

Revision ID: 68b7c737c174
Revises: cc1dd2ee3ff4
Create Date: 2026-06-05 15:09:19.973350

"""
from alembic import op
import sqlalchemy as sa

revision = '68b7c737c174'
down_revision = 'cc1dd2ee3ff4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'agent_status_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('is_available', sa.Boolean(), nullable=False),
        sa.Column('changed_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['agent_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agent_status_log_agent_changed', 'agent_status_log', ['agent_id', 'changed_at'])
    op.create_index('ix_agent_status_log_org_changed', 'agent_status_log', ['organization_id', 'changed_at'])
    op.create_index('ix_agent_status_log_organization_id', 'agent_status_log', ['organization_id'])

    op.add_column('conversations', sa.Column('agents_online_snapshot', sa.Text(), nullable=True))
    op.add_column('conversations', sa.Column('first_agent_joined_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('conversations', 'first_agent_joined_at')
    op.drop_column('conversations', 'agents_online_snapshot')

    op.drop_index('ix_agent_status_log_organization_id', table_name='agent_status_log')
    op.drop_index('ix_agent_status_log_org_changed', table_name='agent_status_log')
    op.drop_index('ix_agent_status_log_agent_changed', table_name='agent_status_log')
    op.drop_table('agent_status_log')
