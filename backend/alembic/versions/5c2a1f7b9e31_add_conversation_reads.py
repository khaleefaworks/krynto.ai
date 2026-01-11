"""add_conversation_reads

Revision ID: 5c2a1f7b9e31
Revises: 99d47795cc55
Create Date: 2026-01-11

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "5c2a1f7b9e31"
down_revision = "99d47795cc55"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    if not inspector.has_table("conversation_reads"):
        op.create_table(
            "conversation_reads",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "conversation_id",
                "user_id",
                name="uq_conversation_reads_conversation_user",
            ),
        )

    existing_indexes = {ix.get("name") for ix in inspector.get_indexes("conversation_reads")}
    if "ix_conversation_reads_user_id_conversation_id" not in existing_indexes:
        op.create_index(
            "ix_conversation_reads_user_id_conversation_id",
            "conversation_reads",
            ["user_id", "conversation_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    if inspector.has_table("conversation_reads"):
        existing_indexes = {ix.get("name") for ix in inspector.get_indexes("conversation_reads")}
        if "ix_conversation_reads_user_id_conversation_id" in existing_indexes:
            op.drop_index(
                "ix_conversation_reads_user_id_conversation_id",
                table_name="conversation_reads",
            )

        op.drop_table("conversation_reads")
