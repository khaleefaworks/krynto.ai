"""add conversation title column

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f7
Create Date: 2025-01-01 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "b1c2d3e4f5a6"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("title", sa.String(120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "title")
