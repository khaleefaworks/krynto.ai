"""step_2_2_inactivity_timestamps

Revision ID: 46963d838181
Revises: 48e25fb7e142
Create Date: 2025-12-29 14:12:49.019904

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '46963d838181'
down_revision = '48e25fb7e142'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("conversations")}

    # Add timestamp fields for inactivity tracking (idempotent)
    if "last_agent_message_at" not in existing_columns:
        op.add_column(
            "conversations",
            sa.Column("last_agent_message_at", sa.DateTime(), nullable=True),
        )

    if "last_visitor_message_at" not in existing_columns:
        op.add_column(
            "conversations",
            sa.Column("last_visitor_message_at", sa.DateTime(), nullable=True),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("conversations")}

    # Remove timestamp fields (idempotent)
    if "last_visitor_message_at" in existing_columns:
        op.drop_column("conversations", "last_visitor_message_at")

    if "last_agent_message_at" in existing_columns:
        op.drop_column("conversations", "last_agent_message_at")
