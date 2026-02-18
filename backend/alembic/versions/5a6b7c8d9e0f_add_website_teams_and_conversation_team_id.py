"""add website teams and conversation team_id

Revision ID: 5a6b7c8d9e0f
Revises: 4d5e6f7a8b9c
Create Date: 2026-02-17

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5a6b7c8d9e0f"
down_revision = "4d5e6f7a8b9c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "website_teams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("website_id", sa.Integer(), sa.ForeignKey("websites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("website_id", "name", name="uq_website_team_name"),
    )
    op.create_index("ix_website_teams_website_id", "website_teams", ["website_id"])

    op.create_table(
        "website_team_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("website_teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("team_id", "user_id", name="uq_website_team_member"),
    )
    op.create_index("ix_website_team_members_team_id", "website_team_members", ["team_id"])
    op.create_index("ix_website_team_members_user_id", "website_team_members", ["user_id"])

    op.add_column(
        "conversations",
        sa.Column("team_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_conversations_team_id", "conversations", ["team_id"])
    op.create_foreign_key(
        "fk_conversations_team_id",
        source_table="conversations",
        referent_table="website_teams",
        local_cols=["team_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_conversations_team_id", "conversations", type_="foreignkey")
    op.drop_index("ix_conversations_team_id", table_name="conversations")
    op.drop_column("conversations", "team_id")

    op.drop_index("ix_website_team_members_user_id", table_name="website_team_members")
    op.drop_index("ix_website_team_members_team_id", table_name="website_team_members")
    op.drop_table("website_team_members")

    op.drop_index("ix_website_teams_website_id", table_name="website_teams")
    op.drop_table("website_teams")
