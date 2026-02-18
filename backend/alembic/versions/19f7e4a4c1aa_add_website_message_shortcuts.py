"""add website message shortcuts

Revision ID: 19f7e4a4c1aa
Revises: 5a6b7c8d9e0f
Create Date: 2026-02-18

"""

from alembic import op
import sqlalchemy as sa


revision = "19f7e4a4c1aa"
down_revision = "5a6b7c8d9e0f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "website_message_shortcuts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("shortcut", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["website_id"], ["websites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("website_id", "shortcut", name="uq_website_message_shortcuts_website_shortcut"),
    )
    op.create_index(
        "ix_website_message_shortcuts_website_id",
        "website_message_shortcuts",
        ["website_id"],
    )


def downgrade():
    op.drop_index("ix_website_message_shortcuts_website_id", table_name="website_message_shortcuts")
    op.drop_table("website_message_shortcuts")
