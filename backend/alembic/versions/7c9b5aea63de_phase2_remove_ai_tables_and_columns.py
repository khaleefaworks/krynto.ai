"""phase2_remove_ai_tables_and_columns

Revision ID: 7c9b5aea63de
Revises: f9ef8b2716e1
Create Date: 2026-01-05 15:10:30.676732

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '7c9b5aea63de'
down_revision = 'f9ef8b2716e1'
branch_labels = None
depends_on = None


def upgrade():
    # Remove AI_HANDLING from conversation_mode enum (PostgreSQL doesn't support direct removal)
    # We'll handle this by updating any existing records, then the app code will ignore it
    op.execute("UPDATE conversations SET mode = 'waiting_for_agent' WHERE mode = 'ai_handling'")
    
    # Drop AI-related tables
    op.execute('DROP TABLE IF EXISTS knowledge_chunks CASCADE')
    op.execute('DROP TABLE IF EXISTS documents CASCADE')
    op.execute('DROP TABLE IF EXISTS knowledge_sources CASCADE')
    
    # Remove AI-related columns from websites
    conn = op.get_bind()
    inspector = inspect(conn)
    schema = inspector.default_schema_name
    website_cols = {c.get('name') for c in inspector.get_columns('websites', schema=schema)}
    if 'ai_enabled' in website_cols:
        op.drop_column('websites', 'ai_enabled')
    if 'ai_instructions' in website_cols:
        op.drop_column('websites', 'ai_instructions')


def downgrade():
    # Recreate AI-related columns
    op.add_column('websites', sa.Column('ai_instructions', sa.Text(), nullable=True))
    op.add_column('websites', sa.Column('ai_enabled', sa.Boolean(), nullable=False, server_default='false'))
    
    # Recreate knowledge_sources table
    op.create_table(
        'knowledge_sources',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('source_type', sa.String(length=50), nullable=False),
        sa.Column('source_content', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Recreate documents table
    op.create_table(
        'documents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('knowledge_source_id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('file_path', sa.String(length=500), nullable=False),
        sa.Column('file_type', sa.String(length=50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['knowledge_source_id'], ['knowledge_sources.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Recreate knowledge_chunks table
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('knowledge_source_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding_id', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['knowledge_source_id'], ['knowledge_sources.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
