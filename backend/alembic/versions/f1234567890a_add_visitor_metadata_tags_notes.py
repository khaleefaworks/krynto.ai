"""add_visitor_metadata_tags_notes

Revision ID: f1234567890a
Revises: 7b896e76a93d
Create Date: 2025-12-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1234567890a'
down_revision = 'c6557a7eeeb7'
branch_labels = None
depends_on = None


def upgrade():
    # Add visitor metadata columns to conversations table
    op.add_column('conversations', sa.Column('visitor_name', sa.String(length=255), nullable=True))
    op.add_column('conversations', sa.Column('visitor_email', sa.String(length=255), nullable=True))
    op.add_column('conversations', sa.Column('visitor_phone', sa.String(length=50), nullable=True))
    op.add_column('conversations', sa.Column('device_info', sa.String(length=255), nullable=True))
    op.add_column('conversations', sa.Column('browser_info', sa.String(length=255), nullable=True))
    op.add_column('conversations', sa.Column('visit_count', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('conversations', sa.Column('last_seen_at', sa.DateTime(), nullable=True))
    
    # Create conversation_tags table
    op.create_table(
        'conversation_tags',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('tag_name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('ix_conversation_tags_conversation_id', 'conversation_tags', ['conversation_id'])
    
    # Create conversation_notes table
    op.create_table(
        'conversation_notes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('ix_conversation_notes_conversation_id', 'conversation_notes', ['conversation_id'])


def downgrade():
    # Drop conversation_notes table
    op.drop_index('ix_conversation_notes_conversation_id', 'conversation_notes')
    op.drop_table('conversation_notes')
    
    # Drop conversation_tags table
    op.drop_index('ix_conversation_tags_conversation_id', 'conversation_tags')
    op.drop_table('conversation_tags')
    
    # Remove visitor metadata columns from conversations
    op.drop_column('conversations', 'last_seen_at')
    op.drop_column('conversations', 'visit_count')
    op.drop_column('conversations', 'browser_info')
    op.drop_column('conversations', 'device_info')
    op.drop_column('conversations', 'visitor_phone')
    op.drop_column('conversations', 'visitor_email')
    op.drop_column('conversations', 'visitor_name')
