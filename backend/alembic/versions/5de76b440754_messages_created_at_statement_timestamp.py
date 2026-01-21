"""messages created_at statement_timestamp

Revision ID: 5de76b440754
Revises: b0704769a9a2
Create Date: 2026-01-21 15:04:33.634351

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5de76b440754'
down_revision = 'b0704769a9a2'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'messages',
        'created_at',
        existing_type=sa.DateTime(timezone=True),
        server_default=sa.text('statement_timestamp()'),
    )


def downgrade():
    op.alter_column(
        'messages',
        'created_at',
        existing_type=sa.DateTime(timezone=True),
        server_default=sa.text('now()'),
    )
