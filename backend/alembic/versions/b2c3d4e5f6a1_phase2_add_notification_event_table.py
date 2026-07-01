"""Add notification_event table for tracking delivery attempts and retry queue.

Revision ID: b2c3d4e5f6a1
Revises: 68b7c737c174
Create Date: 2026-07-01 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a1'
down_revision = '68b7c737c174'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create notification_events table
    # Note: Enum types are created automatically by SQLAlchemy when the table is created
    op.create_table(
        'notification_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('trigger_type', sa.String(50), nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=True),
        sa.Column('delivery_method', sa.Enum('push', 'ws', 'email', name='notification_delivery_method'), nullable=False, server_default='push'),
        sa.Column('status', sa.Enum('pending', 'sent', 'delivered', 'failed', name='notification_event_status'), nullable=False, server_default='pending'),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['agent_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for efficient querying
    op.create_index('ix_notification_events_conversation_id', 'notification_events', ['conversation_id'])
    op.create_index('ix_notification_events_agent_id', 'notification_events', ['agent_id'])
    op.create_index('ix_notification_events_created_at', 'notification_events', ['created_at'])
    op.create_index('ix_notification_events_next_retry_at', 'notification_events', ['next_retry_at'])
    # Composite index for retry job: find pending items due for retry
    op.create_index('ix_notification_events_retry', 'notification_events', ['status', 'next_retry_at'])


def downgrade() -> None:
    op.drop_index('ix_notification_events_retry', table_name='notification_events')
    op.drop_index('ix_notification_events_next_retry_at', table_name='notification_events')
    op.drop_index('ix_notification_events_created_at', table_name='notification_events')
    op.drop_index('ix_notification_events_agent_id', table_name='notification_events')
    op.drop_index('ix_notification_events_conversation_id', table_name='notification_events')
    op.drop_table('notification_events')
