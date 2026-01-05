"""simplify_conversation_status_to_open_resolved

Revision ID: 0f0e79433345
Revises: d195be796393
Create Date: 2026-01-05 16:55:12.448452

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0f0e79433345'
down_revision = 'd195be796393'
branch_labels = None
depends_on = None


def upgrade():
    # Step 1: Add new status column (temporary)
    op.add_column('conversations', sa.Column('new_status', sa.String(20), nullable=True))
    
    # Step 2: Migrate data
    # ACTIVE or OFFLINE → OPEN
    # CLOSED → RESOLVED
    op.execute("""
        UPDATE conversations 
        SET new_status = CASE 
            WHEN status IN ('active', 'offline') THEN 'open'
            WHEN status = 'closed' THEN 'resolved'
            ELSE 'open'
        END
    """)
    
    # Step 3: Drop old columns
    op.drop_column('conversations', 'mode')
    op.drop_column('conversations', 'status')
    
    # Step 4: Rename new_status to status
    op.alter_column('conversations', 'new_status', new_column_name='status', nullable=False)


def downgrade():
    # Reverse migration
    op.add_column('conversations', sa.Column('old_status', sa.String(20), nullable=True))
    op.add_column('conversations', sa.Column('mode', sa.String(30), nullable=True))
    
    # Migrate back
    op.execute("""
        UPDATE conversations 
        SET old_status = CASE 
            WHEN status = 'open' THEN 'active'
            WHEN status = 'resolved' THEN 'closed'
            ELSE 'active'
        END,
        mode = CASE
            WHEN assigned_agent_id IS NULL THEN 'waiting_for_agent'
            ELSE 'agent_handling'
        END
    """)
    
    op.drop_column('conversations', 'status')
    op.alter_column('conversations', 'old_status', new_column_name='status', nullable=False)
