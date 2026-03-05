"""add_conversation_ratings

Revision ID: c75c064b06f5
Revises: b3c4d5e6f7a8
Create Date: 2026-03-05 09:13:36.884143

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c75c064b06f5'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('conversation_ratings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('rating', sa.SmallInteger(), nullable=False),
        sa.Column('feedback', sa.Text(), nullable=True),
        sa.Column('session_id', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_conversation_ratings_conversation_id'),
        'conversation_ratings',
        ['conversation_id'],
        unique=True,
    )


def downgrade():
    op.drop_index(op.f('ix_conversation_ratings_conversation_id'), table_name='conversation_ratings')
    op.drop_table('conversation_ratings')
