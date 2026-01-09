"""add_last_heartbeat_at_to_users

Revision ID: 8c1b7a2d6f3e
Revises: 3a8c4f2b9c1d
Create Date: 2026-01-09

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8c1b7a2d6f3e"
down_revision = "3a8c4f2b9c1d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_last_heartbeat_at", "users", ["last_heartbeat_at"])


def downgrade() -> None:
    op.drop_index("ix_users_last_heartbeat_at", table_name="users")
    op.drop_column("users", "last_heartbeat_at")
