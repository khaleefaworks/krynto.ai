"""step_1_5_conversation_state_expansion

Revision ID: 4eb8b5a9838a
Revises: 166e4553df6c
Create Date: 2025-12-29 13:44:57.998959

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.exc import ProgrammingError


# revision identifiers, used by Alembic.
revision = '4eb8b5a9838a'
down_revision = '166e4553df6c'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create conversation_status enum type
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE conversation_status AS ENUM ('active', 'offline', 'closed');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    # 2. Create message_sender_type enum type
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE message_sender_type AS ENUM ('visitor', 'agent', 'system');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    # 3. Normalize existing values BEFORE converting to enum.
    # Some DBs may already have the later "open/resolved" strings.
    # Use status::text to be safe whether the column is VARCHAR or already enum.
    op.execute("""
        UPDATE conversations
        SET status = CASE
            WHEN status IS NULL THEN 'active'
            WHEN status::text IN ('open') THEN 'active'
            WHEN status::text IN ('resolved') THEN 'closed'
            WHEN status::text NOT IN ('active', 'offline', 'closed') THEN 'active'
            ELSE status::text
        END
    """)

    # 4. Update conversations.status to use enum type (currently VARCHAR)
    # Alter column type to enum
    op.execute("""
        ALTER TABLE conversations 
        ALTER COLUMN status TYPE conversation_status 
        USING status::conversation_status
    """)
    
    # Set NOT NULL and default
    op.execute("""
        ALTER TABLE conversations 
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN status SET DEFAULT 'active'::conversation_status
    """)
    
    # 5. Update conversations.assigned_agent_id FK from agents -> users (when available)
    # Drop old FK constraint
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_assigned_agent_id_fkey;
        EXCEPTION
            WHEN undefined_object THEN null;
        END $$;
    """)

    conn = op.get_bind()
    inspector = inspect(conn)
    schema = inspector.default_schema_name
    tables = set(inspector.get_table_names(schema=schema))

    referent = None
    if 'users' in tables:
        referent = 'users'
    elif 'agents' in tables:
        referent = 'agents'

    if referent:
        try:
            op.create_foreign_key(
                'conversations_assigned_agent_id_fkey',
                'conversations',
                referent,
                ['assigned_agent_id'],
                ['id'],
                ondelete='SET NULL',
                source_schema=schema,
                referent_schema=schema,
            )
        except ProgrammingError:
            pass
    
    # 6. Add sender_type column to messages table
    op.add_column(
        'messages',
        sa.Column('sender_type', sa.Enum('visitor', 'agent', 'system', name='message_sender_type'), 
                  nullable=True, server_default='visitor')
    )
    
    # Backfill sender_type based on existing sender field patterns
    # This is a best-effort migration
    op.execute("""
        UPDATE messages 
        SET sender_type = CASE
            WHEN sender LIKE '%@%' THEN 'agent'::message_sender_type
            WHEN sender = 'system' THEN 'system'::message_sender_type
            ELSE 'visitor'::message_sender_type
        END
        WHERE sender_type IS NULL
    """)
    
    # Make sender_type NOT NULL
    op.execute("""
        ALTER TABLE messages 
        ALTER COLUMN sender_type SET NOT NULL
    """)


def downgrade():
    # Revert messages.sender_type
    op.drop_column('messages', 'sender_type')
    
    # Revert conversations FK
    op.drop_constraint('conversations_assigned_agent_id_fkey', 'conversations', type_='foreignkey')
    op.create_foreign_key(
        'conversations_assigned_agent_id_fkey',
        'conversations',
        'agents',
        ['assigned_agent_id'],
        ['id'],
        ondelete='SET NULL'
    )
    
    # Revert conversations.status to VARCHAR
    op.execute("""
        ALTER TABLE conversations 
        ALTER COLUMN status TYPE VARCHAR(50)
    """)
    
    # Drop enum types
    op.execute("DROP TYPE IF EXISTS message_sender_type")
    op.execute("DROP TYPE IF EXISTS conversation_status")
