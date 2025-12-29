"""step_2_1_conversation_mode

Revision ID: 48e25fb7e142
Revises: 4eb8b5a9838a
Create Date: 2025-12-29 14:04:49.650314

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '48e25fb7e142'
down_revision = '4eb8b5a9838a'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create conversation_mode enum type
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE conversation_mode AS ENUM ('ai_handling', 'waiting_for_agent', 'agent_handling');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    # 2. Add mode column to conversations table (nullable first for backfill)
    op.add_column(
        'conversations',
        sa.Column('mode', sa.Enum('ai_handling', 'waiting_for_agent', 'agent_handling', name='conversation_mode'), 
                  nullable=True)
    )
    
    # 3. Backfill existing rows
    # - If agent is assigned → AGENT_HANDLING
    # - Else → AI_HANDLING (default for existing conversations)
    op.execute("""
        UPDATE conversations 
        SET mode = CASE
            WHEN assigned_agent_id IS NOT NULL THEN 'agent_handling'::conversation_mode
            ELSE 'ai_handling'::conversation_mode
        END
        WHERE mode IS NULL
    """)
    
    # 4. Make mode NOT NULL with default
    op.execute("""
        ALTER TABLE conversations 
        ALTER COLUMN mode SET NOT NULL,
        ALTER COLUMN mode SET DEFAULT 'ai_handling'::conversation_mode
    """)


def downgrade():
    # Drop mode column
    op.drop_column('conversations', 'mode')
    
    # Drop enum type
    op.execute("DROP TYPE IF EXISTS conversation_mode")
