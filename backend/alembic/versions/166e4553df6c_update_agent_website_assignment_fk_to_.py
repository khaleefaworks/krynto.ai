"""update_agent_website_assignment_fk_to_users

Revision ID: 166e4553df6c
Revises: aa58c499cc2a
Create Date: 2025-12-29 13:41:54.128596

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '166e4553df6c'
down_revision = 'aa58c499cc2a'
branch_labels = None
depends_on = None


def upgrade():
    # Drop old foreign key constraint to agents table
    op.drop_constraint(
        'agent_website_assignments_agent_id_fkey',
        'agent_website_assignments',
        type_='foreignkey'
    )
    
    # Create new foreign key constraint to users table
    op.create_foreign_key(
        'agent_website_assignments_agent_id_fkey',
        'agent_website_assignments',
        'users',
        ['agent_id'],
        ['id'],
        ondelete='CASCADE'
    )


def downgrade():
    # Revert to agents table foreign key
    op.drop_constraint(
        'agent_website_assignments_agent_id_fkey',
        'agent_website_assignments',
        type_='foreignkey'
    )
    
    op.create_foreign_key(
        'agent_website_assignments_agent_id_fkey',
        'agent_website_assignments',
        'agents',
        ['agent_id'],
        ['id'],
        ondelete='CASCADE'
    )
