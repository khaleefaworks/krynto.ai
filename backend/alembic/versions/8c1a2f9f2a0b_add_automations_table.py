"""add_automations_table

Revision ID: 8c1a2f9f2a0b
Revises: 5de76b440754
Create Date: 2026-01-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8c1a2f9f2a0b"
down_revision = "5de76b440754"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "automations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("trigger", sa.String(length=100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("conditions", sa.JSON(), nullable=True),
        sa.Column("actions", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["website_id"], ["websites.id"], ondelete="CASCADE"),
    )

    op.create_index("ix_automations_website_id", "automations", ["website_id"])
    op.create_index("ix_automations_trigger", "automations", ["trigger"])
    op.create_index("ix_automations_enabled", "automations", ["enabled"])


def downgrade():
    op.drop_index("ix_automations_enabled", table_name="automations")
    op.drop_index("ix_automations_trigger", table_name="automations")
    op.drop_index("ix_automations_website_id", table_name="automations")
    op.drop_table("automations")
