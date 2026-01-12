"""add_visitor_last_read_at

Revision ID: 47762e1c8c30
Revises: 7d601699a5f4
Create Date: 2026-01-12 21:29:35.229528

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = '47762e1c8c30'
down_revision = '7d601699a5f4'
branch_labels = None
depends_on = None


def upgrade():
    # Minimal migration: only add visitor read-state timestamp.
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_cols = {c.get('name') for c in inspector.get_columns('conversations')}
    if 'visitor_last_read_at' not in existing_cols:
        op.add_column('conversations', sa.Column('visitor_last_read_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_cols = {c.get('name') for c in inspector.get_columns('conversations')}
    if 'visitor_last_read_at' in existing_cols:
        op.drop_column('conversations', 'visitor_last_read_at')
