"""add push subscriptions

Revision ID: 7d601699a5f4
Revises: 5c2a1f7b9e31
Create Date: 2026-01-12 10:52:14.164154

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '7d601699a5f4'
down_revision = '5c2a1f7b9e31'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('endpoint', sa.String(), nullable=False),
        sa.Column('p256dh', sa.String(), nullable=False),
        sa.Column('auth', sa.String(), nullable=False),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['agent_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('agent_id', 'endpoint', name='uq_push_subscriptions_agent_endpoint'),
    )
    op.create_index(op.f('ix_push_subscriptions_agent_id'), 'push_subscriptions', ['agent_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_push_subscriptions_agent_id'), table_name='push_subscriptions')
    op.drop_table('push_subscriptions')
