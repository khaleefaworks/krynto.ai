"""phase1_remove_agent_model_fix_roles_add_fk

Revision ID: f9ef8b2716e1
Revises: f1234567890a
Create Date: 2026-01-05 15:06:27.840539

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'f9ef8b2716e1'
down_revision = 'f1234567890a'
branch_labels = None
depends_on = None


def upgrade():
    # Step 1: Add new enum values for UserRole
    op.execute("COMMIT")
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system_manager'")
    
    # Step 2: Update existing data - rename full_access to system_manager
    op.execute("UPDATE users SET role = 'system_manager' WHERE role = 'full_access'")
    
    # Step 3: Clean up orphaned agent_sessions records before adding FK
    conn = op.get_bind()
    inspector = inspect(conn)
    schema = inspector.default_schema_name
    tables = set(inspector.get_table_names(schema=schema))

    if 'agent_sessions' in tables:
        op.execute("DELETE FROM agent_sessions WHERE agent_id NOT IN (SELECT id FROM users)")

        # Step 4: Add foreign key to agent_sessions.agent_id -> users.id
        # Use a DO block so we don't abort the migration transaction if it already exists.
        op.execute("""
            DO $$ BEGIN
                ALTER TABLE agent_sessions
                ADD CONSTRAINT fk_agent_sessions_agent_id
                FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE;
            EXCEPTION
                WHEN duplicate_object THEN null;
                WHEN undefined_table THEN null;
            END $$;
        """)
    
    # Step 5: Drop agents table (deprecated model)
    if 'agents' in tables:
        op.drop_table('agents')


def downgrade():
    # Recreate agents table
    op.create_table(
        'agents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    
    # Drop foreign key from agent_sessions
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS fk_agent_sessions_agent_id;
        EXCEPTION
            WHEN undefined_table THEN null;
        END $$;
        """
    )
    
    # Revert role changes
    op.execute("UPDATE users SET role = 'full_access' WHERE role = 'system_manager'")
