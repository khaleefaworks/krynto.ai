"""add security events table

Revision ID: 5e71ecb6a96c
Revises: a4996ac54d46
Create Date: 2026-07-18 21:05:33.422990

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5e71ecb6a96c'
down_revision = 'a4996ac54d46'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'security_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('actor_user_id', sa.Integer(), nullable=True),
        sa.Column('target_user_id', sa.Integer(), nullable=True),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('event_metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_security_events_id', 'security_events', ['id'])
    op.create_index('ix_security_events_event_type', 'security_events', ['event_type'])
    op.create_index('ix_security_events_actor_user_id', 'security_events', ['actor_user_id'])
    op.create_index('ix_security_events_target_user_id', 'security_events', ['target_user_id'])
    op.create_index('ix_security_events_organization_id', 'security_events', ['organization_id'])
    op.create_index('ix_security_events_created_at', 'security_events', ['created_at'])


def downgrade():
    op.drop_index('ix_security_events_created_at', table_name='security_events')
    op.drop_index('ix_security_events_organization_id', table_name='security_events')
    op.drop_index('ix_security_events_target_user_id', table_name='security_events')
    op.drop_index('ix_security_events_actor_user_id', table_name='security_events')
    op.drop_index('ix_security_events_event_type', table_name='security_events')
    op.drop_index('ix_security_events_id', table_name='security_events')
    op.drop_table('security_events')
