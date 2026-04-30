"""migrate_automations_to_node_graph

Revision ID: f7e6d5c4b3a2
Revises: ed71c38d8e14
Create Date: 2026-04-29 00:00:00.000000

Replace linear `conditions`/`actions` columns with graph-based `nodes`/`edges`.
All existing automations are cleared — they will be re-seeded fresh by the
AutomationService on next website access.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f7e6d5c4b3a2'
down_revision = 'ed71c38d8e14'
branch_labels = None
depends_on = None


def upgrade():
    # Clear all existing automations (no backward compatibility needed)
    op.execute("DELETE FROM automations")

    # Drop old columns
    op.drop_column('automations', 'conditions')
    op.drop_column('automations', 'actions')

    # Add new graph columns
    op.add_column('automations', sa.Column('nodes', sa.JSON(), nullable=True))
    op.add_column('automations', sa.Column('edges', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('automations', 'nodes')
    op.drop_column('automations', 'edges')
    op.add_column('automations', sa.Column('conditions', sa.JSON(), nullable=True))
    op.add_column('automations', sa.Column('actions', sa.JSON(), nullable=True))
