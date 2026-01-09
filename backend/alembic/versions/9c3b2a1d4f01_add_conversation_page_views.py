"""add_conversation_page_views

Revision ID: 9c3b2a1d4f01
Revises: 2fdc0fc683ab
Create Date: 2026-01-09

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9c3b2a1d4f01"
down_revision = "2fdc0fc683ab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_page_views",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("referrer", sa.Text(), nullable=True),
        sa.Column("device_info", sa.String(length=255), nullable=True),
        sa.Column("browser_info", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["website_id"], ["websites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_conversation_page_views_conversation_id_created_at",
        "conversation_page_views",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "ix_conversation_page_views_website_session_created_at",
        "conversation_page_views",
        ["website_id", "session_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_page_views_website_session_created_at", table_name="conversation_page_views")
    op.drop_index("ix_conversation_page_views_conversation_id_created_at", table_name="conversation_page_views")
    op.drop_table("conversation_page_views")
