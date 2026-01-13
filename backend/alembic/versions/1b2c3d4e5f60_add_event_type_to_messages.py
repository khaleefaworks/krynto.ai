"""add_event_type_to_messages

Revision ID: 1b2c3d4e5f60
Revises: 0f0e79433345
Create Date: 2026-01-06

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1b2c3d4e5f60"
down_revision = "0f0e79433345"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("messages")}

    if "event_type" not in existing_columns:
        op.add_column(
            "messages",
            sa.Column("event_type", sa.String(length=50), nullable=True),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("messages")}

    if "event_type" in existing_columns:
        op.drop_column("messages", "event_type")
